import { DocumentStatus, DocumentType } from '@prisma/client';
import fs from 'node:fs';
import type { Telegram } from 'telegraf';
import { Input } from 'telegraf';

import { config } from '../config';
import { logger } from '../lib/logger';
import { DocumentRepository } from '../repositories/document.repository';
import { FileStorageService } from './file-storage.service';
import type { SignedDocumentForwardingResult } from '../documents/document.formatters';
import { getDocumentTitle } from '../documents/document.constants';
import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { isCurrentOrPermanentSignatureDocument } from '../documents/document-reuse.helpers';
import {
  FIRST_QUEUE_DOCUMENT_TYPES as WORKFLOW_FIRST_QUEUE_DOCUMENT_TYPES,
  SECOND_QUEUE_DOCUMENT_TYPES as WORKFLOW_SECOND_QUEUE_DOCUMENT_TYPES
} from '../documents/document-workflow.constants';
import { assertSignedPdfMatchesDocument } from '../documents/signed-pdf-validation';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import type { DocumentWorkflowService } from './document-workflow.service';
import { formatCreatorDisplayName, formatRussianDateTime } from '../utils/formatters';

const SIGNED_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

const SIGNED_DOCUMENT_FORWARD_READY_DELAY_MS = 45_000;
const SIGNED_DOCUMENT_FORWARD_INCOMPLETE_DELAY_MS = 5 * 60_000;
const TELEGRAM_SEND_RETRY_BUFFER_MS = 1_000;
const TELEGRAM_SEND_MAX_ATTEMPTS = 4;
const TELEGRAM_MANUAL_EXPORT_SEND_DELAY_MS = 1_200;
const TELEGRAM_DOCUMENT_MEDIA_GROUP_MAX_ITEMS = 10;

const SIGNED_DOCUMENT_ORDER: Record<DocumentType, number> = {
  [DocumentType.CONTRACT]: 10,
  [DocumentType.NDA]: 20,
  [DocumentType.ASSIGNMENT]: 30,
  [DocumentType.ACT]: 40,
  [DocumentType.ACT_1000]: 45,
  [DocumentType.RIGHTS_TRANSFER]: 50
};

const FIRST_QUEUE_DOCUMENT_TYPES = new Set<DocumentType>([...WORKFLOW_FIRST_QUEUE_DOCUMENT_TYPES]);

const SECOND_QUEUE_DOCUMENT_TYPES = new Set<DocumentType>([...WORKFLOW_SECOND_QUEUE_DOCUMENT_TYPES]);

const WAITING_FOR_SIGNED_UPLOAD_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.GENERATED,
  DocumentStatus.SENT_TO_CREATOR,
  DocumentStatus.VIEWED_BY_CREATOR
]);

type SignedDocument = NonNullable<Awaited<ReturnType<DocumentRepository['findById']>>>;
type SignedDocumentUpload = Awaited<ReturnType<DocumentRepository['createSignatureUpload']>>;
type PendingSignatureUpload = Awaited<ReturnType<DocumentRepository['listUnforwardedSignatureUploads']>>[number];

interface PendingSignedForwardItem {
  telegram: Telegram;
  chatId: string;
  document: SignedDocument;
  upload: SignedDocumentUpload;
  filePath: string;
  wasAlreadySigned: boolean;
}

interface PendingSignedForwardBatch {
  telegram: Telegram;
  chatId: string;
  creatorUserId: string;
  items: PendingSignedForwardItem[];
  timer: NodeJS.Timeout;
  flushDelayMs: number;
}

class SerializedChatSendQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  enqueue<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(chatId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const tail = current.catch(() => undefined);

    this.tails.set(chatId, tail);
    tail.finally(() => {
      if (this.tails.get(chatId) === tail) {
        this.tails.delete(chatId);
      }
    });

    return current;
  }
}

const formatSignedDocumentTitle = (document: Pick<SignedDocument, 'type' | 'monthKey'>) =>
  `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}`;

const sortSignedForwardItems = (left: PendingSignedForwardItem, right: PendingSignedForwardItem) => {
  const orderDiff = SIGNED_DOCUMENT_ORDER[left.document.type] - SIGNED_DOCUMENT_ORDER[right.document.type];

  if (orderDiff !== 0) {
    return orderDiff;
  }

  return (left.document.monthKey ?? '').localeCompare(right.document.monthKey ?? '');
};

const sortPendingSignatureUploads = (left: PendingSignatureUpload, right: PendingSignatureUpload) => {
  const creatorDiff = formatCreatorDisplayName(left.creator).localeCompare(formatCreatorDisplayName(right.creator), 'ru');

  if (creatorDiff !== 0) {
    return creatorDiff;
  }

  const orderDiff = SIGNED_DOCUMENT_ORDER[left.document.type] - SIGNED_DOCUMENT_ORDER[right.document.type];

  if (orderDiff !== 0) {
    return orderDiff;
  }

  const monthDiff = (left.document.monthKey ?? '').localeCompare(right.document.monthKey ?? '');

  if (monthDiff !== 0) {
    return monthDiff;
  }

  return left.uploadedAt.getTime() - right.uploadedAt.getTime();
};

const groupPendingSignatureUploadsByCreator = (uploads: PendingSignatureUpload[]) => {
  const groups = new Map<string, PendingSignatureUpload[]>();

  for (const upload of uploads) {
    const group = groups.get(upload.creatorUserId) ?? [];
    group.push(upload);
    groups.set(upload.creatorUserId, group);
  }

  return [...groups.values()];
};

const getPendingSignatureUploadLogicalKey = (upload: PendingSignatureUpload) =>
  [
    upload.creatorUserId,
    upload.document.type,
    upload.document.monthKey ?? 'no-month'
  ].join(':');

const compactPendingSignatureUploads = (uploads: PendingSignatureUpload[]) => {
  const latestByKey = new Map<string, PendingSignatureUpload>();

  for (const upload of uploads) {
    const key = getPendingSignatureUploadLogicalKey(upload);
    const existing = latestByKey.get(key);

    if (!existing || upload.uploadedAt.getTime() >= existing.uploadedAt.getTime()) {
      latestByKey.set(key, upload);
    }
  }

  const selectedIds = new Set([...latestByKey.values()].map((upload) => upload.id));

  return {
    uploads: [...latestByKey.values()].sort(sortPendingSignatureUploads),
    supersededUploads: uploads.filter((upload) => !selectedIds.has(upload.id))
  };
};

const getSignedForwardItemLogicalKey = (item: PendingSignedForwardItem) =>
  [
    item.document.creatorUserId,
    item.document.type,
    item.document.monthKey ?? 'no-month'
  ].join(':');

const compactSignedForwardItems = (items: PendingSignedForwardItem[]) => {
  const latestByKey = new Map<string, PendingSignedForwardItem>();

  for (const item of items) {
    const key = getSignedForwardItemLogicalKey(item);
    const existing = latestByKey.get(key);

    if (!existing || item.upload.uploadedAt.getTime() >= existing.upload.uploadedAt.getTime()) {
      latestByKey.set(key, item);
    }
  }

  const selectedIds = new Set([...latestByKey.values()].map((item) => item.upload.id));

  return {
    items: [...latestByKey.values()].sort(sortSignedForwardItems),
    supersededItems: items.filter((item) => !selectedIds.has(item.upload.id))
  };
};

const formatSignedDocumentBatchHeader = (items: PendingSignedForwardItem[]) => {
  const first = items[0];
  const creator = first.document.creator;
  const periods = [...new Set(items.map((item) => item.document.monthKey).filter(Boolean))];
  const documentTitles = items.map((item) => formatSignedDocumentTitle(item.document));
  const hasInitialUploads = items.some((item) => !item.wasAlreadySigned);
  const hasUpdates = items.some((item) => item.wasAlreadySigned);
  const versionLabel = hasInitialUploads && hasUpdates
    ? 'первичная загрузка / обновление'
    : hasUpdates
      ? 'обновление'
      : 'первичная загрузка';

  return [
    'Подписанные документы загружены',
    `Креатор: ${formatCreatorDisplayName(creator)}`,
    creator.username ? `Telegram: @${creator.username}` : creator.telegramId ? `Telegram ID: ${creator.telegramId}` : null,
    periods.length ? `Период: ${periods.join(' / ')}` : null,
    `Документы: ${documentTitles.join(', ')}`,
    `Версия: ${versionLabel}`,
    `Загружено: ${formatRussianDateTime(first.upload.uploadedAt)}`
  ]
    .filter(Boolean)
    .join('\n');
};

const formatSignedDocumentFileCaption = (item: PendingSignedForwardItem) =>
  [
    formatSignedDocumentTitle(item.document),
    item.wasAlreadySigned ? 'Обновление подписанного PDF' : 'Подписанный PDF'
  ].join('\n');

const formatManualExportHeader = (uploads: PendingSignatureUpload[]) => {
  const first = uploads[0];
  const creator = first.creator;
  const periods = [...new Set(uploads.map((upload) => upload.document.monthKey).filter(Boolean))];
  const documentTitles = uploads.map((upload) => formatSignedDocumentTitle(upload.document));
  const hasUpdates = uploads.some((upload) => upload.document.signatureUploads.length > 1);

  return [
    'Подписанные документы',
    `Креатор: ${formatCreatorDisplayName(creator)}`,
    creator.username ? `Telegram: @${creator.username}` : creator.telegramId ? `Telegram ID: ${creator.telegramId}` : null,
    periods.length ? `Период: ${periods.join(' / ')}` : null,
    `Новые документы: ${documentTitles.join(', ')}`,
    `Количество: ${uploads.length}`,
    `Версия: ${hasUpdates ? 'есть обновленные файлы' : 'первичная загрузка'}`,
    `Выгружено: ${formatRussianDateTime(new Date())}`
  ]
    .filter(Boolean)
    .join('\n');
};

const formatManualExportFileCaption = (upload: PendingSignatureUpload) =>
  [
    formatSignedDocumentTitle(upload.document),
    upload.document.signatureUploads.length > 1 ? 'Обновленный подписанный PDF' : 'Подписанный PDF'
  ].join('\n');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getTelegramRetryAfterMs = (error: unknown) => {
  const telegramError = error as {
    parameters?: { retry_after?: number };
    response?: { parameters?: { retry_after?: number } };
  };
  const retryAfterSeconds =
    telegramError.response?.parameters?.retry_after ??
    telegramError.parameters?.retry_after;

  return typeof retryAfterSeconds === 'number'
    ? retryAfterSeconds * 1_000 + TELEGRAM_SEND_RETRY_BUFFER_MS
    : null;
};

const sendTelegramWithRetry = async <T>(
  operation: () => Promise<T>,
  logContext: Record<string, unknown>
) => {
  for (let attempt = 1; attempt <= TELEGRAM_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryAfterMs = getTelegramRetryAfterMs(error);

      if (!retryAfterMs || attempt === TELEGRAM_SEND_MAX_ATTEMPTS) {
        throw error;
      }

      logger.warn(
        {
          error,
          ...logContext,
          attempt,
          retryAfterMs
        },
        'Telegram send rate limited; waiting before retry'
      );
      await sleep(retryAfterMs);
    }
  }

  throw new Error('Telegram send retry attempts exhausted');
};

const chunkForTelegramMediaGroup = <T>(items: T[]) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += TELEGRAM_DOCUMENT_MEDIA_GROUP_MAX_ITEMS) {
    chunks.push(items.slice(index, index + TELEGRAM_DOCUMENT_MEDIA_GROUP_MAX_ITEMS));
  }

  return chunks;
};

const sendLocalDocumentAlbumWithRetry = async <T>(input: {
  telegram: Telegram;
  chatId: string;
  items: T[];
  getFilePath: (item: T) => string;
  getCaption: (item: T, index: number, chunk: T[]) => string;
  getLogContext: (chunk: T[]) => Record<string, unknown>;
  singleOperation: string;
  albumOperation: string;
}) => {
  const sentItems: Array<{ item: T; messageId: number }> = [];

  for (const chunk of chunkForTelegramMediaGroup(input.items)) {
    if (chunk.length === 1) {
      const message = await sendTelegramWithRetry(
        () => input.telegram.sendDocument(input.chatId, Input.fromLocalFile(input.getFilePath(chunk[0])), {
          caption: input.getCaption(chunk[0], 0, chunk)
        }),
        {
          ...input.getLogContext(chunk),
          operation: input.singleOperation
        }
      );

      sentItems.push({ item: chunk[0], messageId: message.message_id });
      await sleep(TELEGRAM_MANUAL_EXPORT_SEND_DELAY_MS);
      continue;
    }

    const messages = await sendTelegramWithRetry(
      () => input.telegram.sendMediaGroup(
        input.chatId,
        chunk.map((item, index) => ({
          type: 'document' as const,
          media: Input.fromLocalFile(input.getFilePath(item)),
          caption: input.getCaption(item, index, chunk)
        }))
      ),
      {
        ...input.getLogContext(chunk),
        operation: input.albumOperation
      }
    );

    for (const [index, message] of messages.entries()) {
      sentItems.push({ item: chunk[index], messageId: message.message_id });
    }

    await sleep(TELEGRAM_MANUAL_EXPORT_SEND_DELAY_MS);
  }

  return sentItems;
};

const hasDocumentsWaitingForSignedUpload = (documents: Array<{ status: DocumentStatus | 'NOT_GENERATED' | 'LOCKED' }>) =>
  documents.some((document) =>
    document.status !== 'NOT_GENERATED' &&
    document.status !== 'LOCKED' &&
    WAITING_FOR_SIGNED_UPLOAD_STATUSES.has(document.status)
  );

export class DocumentUploadService {
  private readonly chatSendQueue = new SerializedChatSendQueue();
  private readonly pendingForwardBatches = new Map<string, PendingSignedForwardBatch>();

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly googleSheetsSyncService?: GoogleSheetsSyncService,
    private readonly documentWorkflowService?: DocumentWorkflowService
  ) {}

  async exportPendingSignedDocumentsToChat(
    telegram: Telegram,
    chatId: string,
    input: { includeAlreadyForwarded?: boolean } = {}
  ) {
    return this.chatSendQueue.enqueue(chatId, async () => {
      const rawUploads = (await this.documentRepository.listUnforwardedSignatureUploads(input))
        .filter((upload) => isCurrentOrPermanentSignatureDocument(upload.document))
        .sort(sortPendingSignatureUploads);
      const { uploads, supersededUploads } = compactPendingSignatureUploads(rawUploads);

      if (!input.includeAlreadyForwarded && supersededUploads.length) {
        await this.documentRepository.markSignatureUploadsSuperseded(
          supersededUploads.map((upload) => upload.id),
          `superseded:${chatId}`
        );

        logger.info(
          {
            documentsChatId: chatId,
            supersededCount: supersededUploads.length,
            supersededUploads: supersededUploads.map((upload) => ({
              uploadId: upload.id,
              documentId: upload.documentId,
              creatorUserId: upload.creatorUserId,
              type: upload.document.type,
              monthKey: upload.document.monthKey
            }))
          },
          'Superseded duplicate signed PDF uploads before manual documents export'
        );
      }

      if (!uploads.length) {
        return {
          creatorCount: 0,
          uploadCount: 0,
          sentUploads: [],
          skippedUploads: []
        };
      }

      const sentUploads: Array<{
        uploadId: string;
        documentId: string;
        type: DocumentType;
        monthKey: string | null;
        messageId: number;
      }> = [];
      const skippedUploads: Array<{
        uploadId: string;
        documentId: string;
        type: DocumentType;
        monthKey: string | null;
        reason: string;
      }> = [];

      const groups = groupPendingSignatureUploadsByCreator(uploads);

      for (const groupUploads of groups) {
        const creator = groupUploads[0].creator;
        const availableUploads: PendingSignatureUpload[] = [];

        for (const upload of groupUploads) {
          if (await this.isSignedUploadBlockedByMissingReceipt(upload)) {
            skippedUploads.push({
              uploadId: upload.id,
              documentId: upload.documentId,
              type: upload.document.type,
              monthKey: upload.document.monthKey,
              reason: 'receipt_missing'
            });
            continue;
          }

          if (!fs.existsSync(upload.filePath)) {
            logger.error(
              {
                creatorUserId: upload.creatorUserId,
                documentId: upload.documentId,
                uploadId: upload.id,
                filePath: upload.filePath
              },
              'Signed PDF file is missing during manual documents export'
            );

            skippedUploads.push({
              uploadId: upload.id,
              documentId: upload.documentId,
              type: upload.document.type,
              monthKey: upload.document.monthKey,
              reason: 'file_missing'
            });
            continue;
          }

          availableUploads.push(upload);
        }

        if (!availableUploads.length) {
          continue;
        }

        let sentAlbumItems: Array<{ item: PendingSignatureUpload; messageId: number }>;

        try {
          sentAlbumItems = await sendLocalDocumentAlbumWithRetry({
            telegram,
            chatId,
            items: availableUploads,
            getFilePath: (upload) => upload.filePath,
            getCaption: (upload, index, chunk) =>
              index === 0 ? formatManualExportHeader(chunk) : formatManualExportFileCaption(upload),
            getLogContext: (chunk) => ({
              creatorUserId: creator.id,
              documentsChatId: chatId,
              uploadIds: chunk.map((upload) => upload.id)
            }),
            singleOperation: 'manual_export_document',
            albumOperation: 'manual_export_album'
          });
        } catch (error) {
          logger.error(
            {
              error,
              creatorUserId: creator.id,
              documentsChatId: chatId,
              uploadIds: availableUploads.map((upload) => upload.id)
            },
            'Failed to send signed PDF album during manual documents export'
          );

          for (const upload of availableUploads) {
            skippedUploads.push({
              uploadId: upload.id,
              documentId: upload.documentId,
              type: upload.document.type,
              monthKey: upload.document.monthKey,
              reason: 'document_send_failed'
            });
          }

          continue;
        }

        for (const sentItem of sentAlbumItems) {
          const upload = sentItem.item;

          try {
            await this.documentRepository.updateSignatureForwardInfo(upload.id, chatId, sentItem.messageId);
            await this.documentRepository.updateStatus(upload.documentId, DocumentStatus.FORWARDED_TO_CHAT, {
              forwardedAt: new Date()
            });

            sentUploads.push({
              uploadId: upload.id,
              documentId: upload.documentId,
              type: upload.document.type,
              monthKey: upload.document.monthKey,
              messageId: sentItem.messageId
            });
          } catch (error) {
            logger.error(
              {
                error,
                creatorUserId: upload.creatorUserId,
                documentId: upload.documentId,
                uploadId: upload.id,
                documentsChatId: chatId,
                messageId: sentItem.messageId
              },
              'Failed to mark signed PDF forwarded after manual documents export album'
            );

            skippedUploads.push({
              uploadId: upload.id,
              documentId: upload.documentId,
              type: upload.document.type,
              monthKey: upload.document.monthKey,
              reason: 'forward_mark_failed'
            });
          }
        }
      }

      await this.googleSheetsSyncService?.safeSyncDocuments([
        ...new Set(sentUploads.map((upload) => upload.documentId))
      ]);

      logger.info(
        {
          documentsChatId: chatId,
          creatorCount: groups.length,
          uploadCount: uploads.length,
          rawUploadCount: rawUploads.length,
          supersededCount: supersededUploads.length,
          sentCount: sentUploads.length,
          skippedCount: skippedUploads.length
        },
        'Manual signed documents export completed'
      );

      return {
        creatorCount: groups.length,
        uploadCount: uploads.length,
        supersededCount: supersededUploads.length,
        sentUploads,
        skippedUploads
      };
    });
  }

  async acceptSignedPdf(params: {
    telegram: Telegram;
    creatorUserId: string;
    documentId: string;
    telegramFileId: string;
    telegramDocumentId?: string;
    originalFileName: string;
    mimeType?: string;
  }) {
    if (
      !isPdfTelegramDocument({
        file_name: params.originalFileName,
        mime_type: params.mimeType
      })
    ) {
      throw new Error('Нужен PDF-файл. Отправь документ с расширением .pdf.');
    }

    const document = await this.documentRepository.findById(params.documentId);

    if (!document || document.creatorUserId !== params.creatorUserId) {
      throw new Error('Документ для загрузки подписи не найден');
    }

    const wasAlreadySigned = SIGNED_STATUSES.has(document.status);

    const fileLink = await params.telegram.getFileLink(params.telegramFileId);
    const response = await fetch(fileLink.toString());

    if (!response.ok) {
      throw new Error('Не удалось скачать PDF из Telegram');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new Error('Файл не похож на PDF. Проверь файл и отправь подписанный PDF еще раз.');
    }

    await assertSignedPdfMatchesDocument({
      buffer,
      expectedType: document.type
    });

    const uploadedAt = new Date();
    const stored = await this.fileStorageService.saveSignedPdf({
      creatorUserId: params.creatorUserId,
      type: document.type,
      monthKey: document.monthKey ?? undefined,
      scopeKey: document.scopeKey === 'permanent' || document.scopeKey === document.monthKey ? undefined : document.scopeKey,
      buffer,
      uploadedAt
    });

    const upload = await this.documentRepository.createSignatureUpload({
      documentId: document.id,
      creatorUserId: params.creatorUserId,
      telegramFileId: params.telegramFileId,
      telegramDocumentId: params.telegramDocumentId,
      originalFileName: params.originalFileName,
      mimeType: params.mimeType,
      filePath: stored.filePath,
      uploadedAt
    });

    await this.documentRepository.updateStatus(document.id, DocumentStatus.SIGNED_UPLOADED, {
      signedUploadedAt: uploadedAt
    });
    await this.documentWorkflowService?.handleSignedDocument(document.id);

    const forwarding: SignedDocumentForwardingResult = config.documents.chatId
      ? { status: 'pending_manual_export', chatId: config.documents.chatId }
      : { status: 'skipped', reason: 'chat_not_configured' };

    await this.googleSheetsSyncService?.safeSyncDocuments([document.id]);

    return {
      document,
      upload,
      stored,
      forwarding,
      wasAlreadySigned
    };
  }

  private async isSignedUploadBlockedByMissingReceipt(upload: PendingSignatureUpload) {
    if (
      !this.documentWorkflowService ||
      !SECOND_QUEUE_DOCUMENT_TYPES.has(upload.document.type) ||
      !upload.document.monthKey
    ) {
      return false;
    }

    const hasReceipt = await this.documentWorkflowService.hasReceiptForCreatorMonth(
      upload.creatorUserId,
      upload.document.monthKey
    );

    if (hasReceipt) {
      return false;
    }

    logger.warn(
      {
        creatorUserId: upload.creatorUserId,
        documentId: upload.documentId,
        uploadId: upload.id,
        type: upload.document.type,
        monthKey: upload.document.monthKey
      },
      'Signed second queue document export skipped until receipt is uploaded'
    );

    return true;
  }

  private async enqueueSignedDocumentForwarding(input: PendingSignedForwardItem) {
    const batchKey = `${input.chatId}:${input.document.creatorUserId}`;
    const flushDelayMs = await this.getSignedDocumentForwardBatchDelay(input.document);

    const existingBatch = this.pendingForwardBatches.get(batchKey);

    if (existingBatch) {
      clearTimeout(existingBatch.timer);
      existingBatch.telegram = input.telegram;
      existingBatch.items.push(input);
      existingBatch.flushDelayMs = flushDelayMs;
      existingBatch.timer = setTimeout(
        () => void this.flushSignedDocumentForwardBatch(batchKey),
        flushDelayMs
      );

      logger.info(
        {
          creatorUserId: input.document.creatorUserId,
          documentsChatId: input.chatId,
          documentCount: existingBatch.items.length,
          flushDelayMs
        },
        'Signed document added to pending creator batch'
      );

      return {
        status: 'queued' as const,
        chatId: input.chatId
      };
    }

    this.pendingForwardBatches.set(batchKey, {
      telegram: input.telegram,
      chatId: input.chatId,
      creatorUserId: input.document.creatorUserId,
      items: [input],
      flushDelayMs,
      timer: setTimeout(
        () => void this.flushSignedDocumentForwardBatch(batchKey),
        flushDelayMs
      )
    });

    logger.info(
      {
        creatorUserId: input.document.creatorUserId,
        documentsChatId: input.chatId,
        documentCount: 1,
        flushDelayMs
      },
      'Signed document creator batch started'
    );

    return {
      status: 'queued' as const,
      chatId: input.chatId
    };
  }

  private async getSignedDocumentForwardBatchDelay(document: SignedDocument) {
    if (!this.documentWorkflowService) {
      return SIGNED_DOCUMENT_FORWARD_READY_DELAY_MS;
    }

    try {
      if (FIRST_QUEUE_DOCUMENT_TYPES.has(document.type)) {
        const summary = await this.documentWorkflowService.getActiveRosterFirstQueueSummary(document.creatorUserId);

        return hasDocumentsWaitingForSignedUpload(summary.documents)
          ? SIGNED_DOCUMENT_FORWARD_INCOMPLETE_DELAY_MS
          : SIGNED_DOCUMENT_FORWARD_READY_DELAY_MS;
      }

      if (SECOND_QUEUE_DOCUMENT_TYPES.has(document.type)) {
        const summary = await this.documentWorkflowService.getActiveRosterSecondQueueSummary(document.creatorUserId);

        return hasDocumentsWaitingForSignedUpload(summary.documents)
          ? SIGNED_DOCUMENT_FORWARD_INCOMPLETE_DELAY_MS
          : SIGNED_DOCUMENT_FORWARD_READY_DELAY_MS;
      }
    } catch (error) {
      logger.warn(
        {
          error,
          creatorUserId: document.creatorUserId,
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey
        },
        'Could not inspect signed document workflow before forwarding; using short batch delay'
      );
    }

    return SIGNED_DOCUMENT_FORWARD_READY_DELAY_MS;
  }

  private async flushSignedDocumentForwardBatch(batchKey: string) {
    const batch = this.pendingForwardBatches.get(batchKey);

    if (!batch) {
      return;
    }

    clearTimeout(batch.timer);
    this.pendingForwardBatches.delete(batchKey);

    await this.chatSendQueue.enqueue(batch.chatId, async () => {
      const { items, supersededItems } = compactSignedForwardItems(batch.items);

      if (supersededItems.length) {
        await this.documentRepository.markSignatureUploadsSuperseded(
          supersededItems.map((item) => item.upload.id),
          `superseded:${batch.chatId}`
        );

        logger.info(
          {
            creatorUserId: batch.creatorUserId,
            documentsChatId: batch.chatId,
            supersededCount: supersededItems.length,
            supersededUploads: supersededItems.map((item) => ({
              uploadId: item.upload.id,
              documentId: item.document.id,
              type: item.document.type,
              monthKey: item.document.monthKey
            }))
          },
          'Superseded duplicate signed PDF uploads before automatic documents chat batch'
        );
      }

      const availableItems = items.filter((item) => {
        if (fs.existsSync(item.filePath)) {
          return true;
        }

        logger.error(
          {
            creatorUserId: batch.creatorUserId,
            documentId: item.document.id,
            uploadId: item.upload.id,
            documentsChatId: batch.chatId,
            filePath: item.filePath
          },
          'Signed PDF file is missing before automatic documents chat album'
        );
        return false;
      });

      let sentAlbumItems: Array<{ item: PendingSignedForwardItem; messageId: number }>;

      if (!availableItems.length) {
        return;
      }

      try {
        sentAlbumItems = await sendLocalDocumentAlbumWithRetry({
          telegram: batch.telegram,
          chatId: batch.chatId,
          items: availableItems,
          getFilePath: (item) => item.filePath,
          getCaption: (item, index, chunk) =>
            index === 0 ? formatSignedDocumentBatchHeader(chunk) : formatSignedDocumentFileCaption(item),
          getLogContext: (chunk) => ({
            creatorUserId: batch.creatorUserId,
            documentsChatId: batch.chatId,
            uploadIds: chunk.map((item) => item.upload.id)
          }),
          singleOperation: 'automatic_forward_document',
          albumOperation: 'automatic_forward_album'
        });
      } catch (error) {
        logger.error(
          {
            error,
            creatorUserId: batch.creatorUserId,
            documentsChatId: batch.chatId,
            uploadIds: availableItems.map((item) => item.upload.id)
          },
          'Failed to forward signed document album to documents chat'
        );
        return;
      }

      for (const sentItem of sentAlbumItems) {
        const item = sentItem.item;

        try {
          await this.documentRepository.updateSignatureForwardInfo(
            item.upload.id,
            batch.chatId,
            sentItem.messageId
          );
          await this.documentRepository.updateStatus(item.document.id, DocumentStatus.FORWARDED_TO_CHAT, {
            forwardedAt: new Date()
          });
        } catch (error) {
          logger.error(
            {
              error,
              creatorUserId: batch.creatorUserId,
              documentId: item.document.id,
              uploadId: item.upload.id,
              documentsChatId: batch.chatId
            },
            'Failed to mark signed document forwarded after documents chat album'
          );
        }
      }

      await this.googleSheetsSyncService?.safeSyncDocuments(sentAlbumItems.map((sentItem) => sentItem.item.document.id));

      logger.info(
        {
          creatorUserId: batch.creatorUserId,
          documentsChatId: batch.chatId,
          documentCount: sentAlbumItems.length,
          documents: sentAlbumItems.map((sentItem) => ({
            documentId: sentItem.item.document.id,
            uploadId: sentItem.item.upload.id,
            type: sentItem.item.document.type,
            monthKey: sentItem.item.document.monthKey,
            messageId: sentItem.messageId
          }))
        },
        'Signed document batch forwarded to documents chat'
      );
    });
  }
}
