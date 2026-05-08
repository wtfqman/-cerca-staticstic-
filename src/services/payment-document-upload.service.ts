import { DocumentStatus, DocumentType, PaymentDocumentType } from '@prisma/client';
import fs from 'node:fs';
import type { Telegram } from 'telegraf';
import { Input } from 'telegraf';

import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { isCreatorInvoiceMonth } from '../documents/document-workflow.constants';
import { getDocumentTitle } from '../documents/document.constants';
import { logger } from '../lib/logger';
import { getCreatorInvoiceDisplayAmount } from '../payments/payment.constants';
import { DocumentRepository } from '../repositories/document.repository';
import { DocumentWorkflowRepository } from '../repositories/document-workflow.repository';
import { formatCreatorDisplayName, formatIntegerRu } from '../utils/formatters';
import { DocumentWorkflowService } from './document-workflow.service';
import { FileStorageService } from './file-storage.service';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import { PaymentCalculationService } from './payment-calculation.service';

const PAYMENT_DOCUMENT_EXPORT_SEND_DELAY_MS = 1_200;
const INVOICE_RELATED_SIGNED_DOCUMENT_TYPES = [
  DocumentType.ACT,
  DocumentType.RIGHTS_TRANSFER,
  DocumentType.ASSIGNMENT
] as const;

const INVOICE_RELATED_SIGNED_DOCUMENT_ORDER: Partial<Record<DocumentType, number>> = {
  [DocumentType.ACT]: 10,
  [DocumentType.RIGHTS_TRANSFER]: 20,
  [DocumentType.ASSIGNMENT]: 30
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SerializedPaymentChatSendQueue {
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

type PaymentUploadForExport =
  Awaited<ReturnType<DocumentWorkflowRepository['listPaymentUploadsForExport']>>[number];
type RelatedSignedDocumentUpload =
  Awaited<ReturnType<DocumentRepository['listLatestSignedSignatureUploadsForCreatorMonth']>>[number];

const getPaymentDocumentTitle = (type: PaymentDocumentType) =>
  type === PaymentDocumentType.INVOICE ? 'Счет' : 'Чек';

const getRelatedSignedDocumentOrder = (type: DocumentType) =>
  INVOICE_RELATED_SIGNED_DOCUMENT_ORDER[type] ?? 999;

const sortRelatedSignedDocumentUploads = (
  left: RelatedSignedDocumentUpload,
  right: RelatedSignedDocumentUpload
) => {
  const orderDiff = getRelatedSignedDocumentOrder(left.document.type) - getRelatedSignedDocumentOrder(right.document.type);

  if (orderDiff !== 0) {
    return orderDiff;
  }

  return left.uploadedAt.getTime() - right.uploadedAt.getTime();
};

const compactRelatedSignedDocumentUploads = (uploads: RelatedSignedDocumentUpload[]) => {
  const latestByKey = new Map<string, RelatedSignedDocumentUpload>();

  for (const upload of uploads) {
    const key = `${upload.creatorUserId}:${upload.document.type}:${upload.document.monthKey ?? ''}`;
    const existing = latestByKey.get(key);

    if (!existing || upload.uploadedAt.getTime() >= existing.uploadedAt.getTime()) {
      latestByKey.set(key, upload);
    }
  }

  return [...latestByKey.values()].sort(sortRelatedSignedDocumentUploads);
};

const compactPaymentUploadsForExport = (uploads: PaymentUploadForExport[]) => {
  const latestByKey = new Map<string, PaymentUploadForExport>();
  const supersededUploads: PaymentUploadForExport[] = [];

  for (const upload of [...uploads].sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())) {
    const key = `${upload.creatorUserId}:${upload.monthKey ?? ''}:${upload.type}`;

    if (latestByKey.has(key)) {
      supersededUploads.push(upload);
      continue;
    }

    latestByKey.set(key, upload);
  }

  return {
    uploads: Array.from(latestByKey.values()).sort((left, right) =>
      [
        left.monthKey ?? '',
        formatCreatorDisplayName(left.creator),
        left.type,
        left.uploadedAt.toISOString()
      ].join(':').localeCompare([
        right.monthKey ?? '',
        formatCreatorDisplayName(right.creator),
        right.type,
        right.uploadedAt.toISOString()
      ].join(':'), 'ru')
    ),
    supersededUploads
  };
};

export class PaymentDocumentUploadService {
  private readonly chatSendQueue = new SerializedPaymentChatSendQueue();

  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly documentWorkflowService: DocumentWorkflowService,
    private readonly documentWorkflowRepository: DocumentWorkflowRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly paymentCalculationService: PaymentCalculationService,
    private readonly googleSheetsSyncService?: GoogleSheetsSyncService
  ) {}

  async acceptInvoicePdf(params: {
    telegram: Telegram;
    creatorUserId: string;
    monthKey: string;
    campaignKey?: string;
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
      throw new Error('Нужен PDF-файл счета. Отправь документ с расширением .pdf.');
    }

    const access = await this.documentWorkflowService.canUploadInvoice(
      params.creatorUserId,
      params.monthKey,
      params.campaignKey
    );

    if (!access.allowed) {
      throw new Error(access.reason);
    }

    const workflowState = access.state;

    if (!workflowState) {
      throw new Error('Сейчас не удалось открыть загрузку счета. Попробуй еще раз.');
    }

    const fileLink = await params.telegram.getFileLink(params.telegramFileId);
    const response = await fetch(fileLink.toString());

    if (!response.ok) {
      throw new Error('Сейчас не удалось скачать счет из Telegram. Попробуй отправить файл еще раз.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new Error('Файл не похож на PDF. Проверь файл и отправь счет еще раз.');
    }

    const stored = await this.fileStorageService.savePaymentDocument({
      creatorUserId: params.creatorUserId,
      workflowStateId: workflowState.id,
      type: PaymentDocumentType.INVOICE,
      monthKey: params.monthKey,
      buffer,
      originalFileName: params.originalFileName
    });

    const updatedWorkflowState = await this.documentWorkflowService.recordPaymentUpload({
      workflowStateId: workflowState.id,
      creatorUserId: params.creatorUserId,
      type: PaymentDocumentType.INVOICE,
      monthKey: params.monthKey,
      telegramFileId: params.telegramFileId,
      telegramDocumentId: params.telegramDocumentId,
      originalFileName: params.originalFileName,
      mimeType: params.mimeType,
      filePath: stored.filePath
    });

    return {
      stored,
      workflowState: updatedWorkflowState
    };
  }

  async acceptReceiptPdf(params: {
    telegram: Telegram;
    creatorUserId: string;
    monthKey: string;
    campaignKey?: string;
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
      throw new Error('Нужен PDF-файл чека. Отправь документ с расширением .pdf.');
    }

    const access = await this.documentWorkflowService.canUploadReceipt(
      params.creatorUserId,
      params.monthKey,
      params.campaignKey
    );

    if (!access.allowed) {
      throw new Error(access.reason);
    }

    const workflowState = access.state;

    if (!workflowState) {
      throw new Error('Сейчас не удалось открыть загрузку чека. Попробуй еще раз.');
    }

    const fileLink = await params.telegram.getFileLink(params.telegramFileId);
    const response = await fetch(fileLink.toString());

    if (!response.ok) {
      throw new Error('Сейчас не удалось скачать чек из Telegram. Попробуй отправить файл еще раз.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new Error('Файл не похож на PDF. Проверь файл и отправь чек еще раз.');
    }

    const stored = await this.fileStorageService.savePaymentDocument({
      creatorUserId: params.creatorUserId,
      workflowStateId: workflowState.id,
      type: PaymentDocumentType.RECEIPT,
      monthKey: params.monthKey,
      buffer,
      originalFileName: params.originalFileName
    });

    const updatedWorkflowState = await this.documentWorkflowService.recordPaymentUpload({
      workflowStateId: workflowState.id,
      creatorUserId: params.creatorUserId,
      type: PaymentDocumentType.RECEIPT,
      monthKey: params.monthKey,
      telegramFileId: params.telegramFileId,
      telegramDocumentId: params.telegramDocumentId,
      originalFileName: params.originalFileName,
      mimeType: params.mimeType,
      filePath: stored.filePath
    });

    return {
      stored,
      workflowState: updatedWorkflowState
    };
  }

  async exportPaymentDocumentsToChat(
    telegram: Telegram,
    chatId: string,
    input: {
      type: PaymentDocumentType;
      monthKey?: string;
      includeAlreadyForwarded?: boolean;
      includeRelatedSignedDocuments?: boolean;
    }
  ) {
    return this.chatSendQueue.enqueue(chatId, async () => {
      const rawUploads = await this.documentWorkflowRepository.listPaymentUploadsForExport(input);
      const { uploads, supersededUploads } = compactPaymentUploadsForExport(rawUploads);

      if (!input.includeAlreadyForwarded && supersededUploads.length) {
        await this.documentWorkflowRepository.markPaymentUploadsSuperseded(
          supersededUploads.map((upload) => upload.id),
          `superseded:${chatId}`
        );
      }

      const sentUploads: Array<{
        uploadId: string;
        creatorUserId: string;
        creatorName: string;
        monthKey: string | null;
        type: PaymentDocumentType;
        messageId: number;
      }> = [];
      const skippedUploads: Array<{
        uploadId: string;
        creatorUserId: string;
        creatorName: string;
        monthKey: string | null;
        type: PaymentDocumentType;
        reason: string;
      }> = [];
      const sentRelatedDocuments: Array<{
        uploadId: string;
        invoiceUploadId: string;
        documentId: string;
        creatorUserId: string;
        creatorName: string;
        monthKey: string | null;
        type: DocumentType;
        messageId: number;
      }> = [];
      const skippedRelatedDocuments: Array<{
        uploadId: string;
        invoiceUploadId: string;
        documentId: string;
        creatorUserId: string;
        creatorName: string;
        monthKey: string | null;
        type: DocumentType;
        reason: string;
      }> = [];

      for (const upload of uploads) {
        const creatorName = formatCreatorDisplayName(upload.creator);
        const fileInput = upload.filePath && fs.existsSync(upload.filePath)
          ? Input.fromLocalFile(upload.filePath)
          : upload.telegramFileId ?? null;

        if (!fileInput) {
          logger.error(
            {
              uploadId: upload.id,
              creatorUserId: upload.creatorUserId,
              monthKey: upload.monthKey,
              type: upload.type,
              filePath: upload.filePath
            },
            'Payment document file is missing during export'
          );

          skippedUploads.push({
            uploadId: upload.id,
            creatorUserId: upload.creatorUserId,
            creatorName,
            monthKey: upload.monthKey,
            type: upload.type,
            reason: 'file_missing'
          });
          continue;
        }

        try {
          const message = await telegram.sendDocument(chatId, fileInput, {
            caption: await this.formatPaymentDocumentExportCaption(upload)
          });
          await sleep(PAYMENT_DOCUMENT_EXPORT_SEND_DELAY_MS);

          await this.documentWorkflowRepository.updatePaymentUploadForwardInfo(upload.id, chatId, message.message_id);
          if (upload.monthKey) {
            await this.googleSheetsSyncService?.safeSyncPaymentsForCreatorMonth(upload.creatorUserId, upload.monthKey);
          }

          sentUploads.push({
            uploadId: upload.id,
            creatorUserId: upload.creatorUserId,
            creatorName,
            monthKey: upload.monthKey,
            type: upload.type,
            messageId: message.message_id
          });

          if (input.includeRelatedSignedDocuments && upload.type === PaymentDocumentType.INVOICE) {
            const relatedUploads = await this.listRelatedSignedDocumentsForInvoice(upload);

            for (const relatedUpload of relatedUploads) {
              const relatedFileInput = relatedUpload.filePath && fs.existsSync(relatedUpload.filePath)
                ? Input.fromLocalFile(relatedUpload.filePath)
                : relatedUpload.telegramFileId ?? null;

              if (!relatedFileInput) {
                logger.error(
                  {
                    uploadId: relatedUpload.id,
                    invoiceUploadId: upload.id,
                    creatorUserId: relatedUpload.creatorUserId,
                    documentId: relatedUpload.documentId,
                    documentType: relatedUpload.document.type,
                    monthKey: relatedUpload.document.monthKey,
                    filePath: relatedUpload.filePath
                  },
                  'Related signed document file is missing during invoice export'
                );

                skippedRelatedDocuments.push({
                  uploadId: relatedUpload.id,
                  invoiceUploadId: upload.id,
                  documentId: relatedUpload.documentId,
                  creatorUserId: relatedUpload.creatorUserId,
                  creatorName,
                  monthKey: relatedUpload.document.monthKey,
                  type: relatedUpload.document.type,
                  reason: 'file_missing'
                });
                continue;
              }

              try {
                const relatedMessage = await telegram.sendDocument(chatId, relatedFileInput, {
                  caption: this.formatInvoiceRelatedDocumentExportCaption(upload, relatedUpload)
                });
                await sleep(PAYMENT_DOCUMENT_EXPORT_SEND_DELAY_MS);

                await this.documentRepository.updateSignatureForwardInfo(
                  relatedUpload.id,
                  chatId,
                  relatedMessage.message_id
                );
                await this.documentRepository.updateStatus(relatedUpload.documentId, DocumentStatus.FORWARDED_TO_CHAT, {
                  forwardedAt: new Date()
                });

                sentRelatedDocuments.push({
                  uploadId: relatedUpload.id,
                  invoiceUploadId: upload.id,
                  documentId: relatedUpload.documentId,
                  creatorUserId: relatedUpload.creatorUserId,
                  creatorName,
                  monthKey: relatedUpload.document.monthKey,
                  type: relatedUpload.document.type,
                  messageId: relatedMessage.message_id
                });
              } catch (error) {
                logger.error(
                  {
                    error,
                    uploadId: relatedUpload.id,
                    invoiceUploadId: upload.id,
                    creatorUserId: relatedUpload.creatorUserId,
                    documentId: relatedUpload.documentId,
                    documentType: relatedUpload.document.type,
                    monthKey: relatedUpload.document.monthKey,
                    documentsChatId: chatId
                  },
                  'Related signed document export failed'
                );

                skippedRelatedDocuments.push({
                  uploadId: relatedUpload.id,
                  invoiceUploadId: upload.id,
                  documentId: relatedUpload.documentId,
                  creatorUserId: relatedUpload.creatorUserId,
                  creatorName,
                  monthKey: relatedUpload.document.monthKey,
                  type: relatedUpload.document.type,
                  reason: 'send_failed'
                });
              }
            }
          }
        } catch (error) {
          logger.error(
            {
              error,
              uploadId: upload.id,
              creatorUserId: upload.creatorUserId,
              monthKey: upload.monthKey,
              type: upload.type,
              documentsChatId: chatId
            },
            'Payment document export failed'
          );

          skippedUploads.push({
            uploadId: upload.id,
            creatorUserId: upload.creatorUserId,
            creatorName,
            monthKey: upload.monthKey,
            type: upload.type,
            reason: 'send_failed'
          });
        }
      }

      const relatedDocumentIds = [...new Set(sentRelatedDocuments.map((upload) => upload.documentId))];
      if (relatedDocumentIds.length) {
        await this.googleSheetsSyncService?.safeSyncDocuments(relatedDocumentIds);
      }

      return {
        type: input.type,
        monthKey: input.monthKey ?? null,
        uploadCount: uploads.length,
        supersededCount: supersededUploads.length,
        sentUploads,
        skippedUploads,
        relatedDocumentCount: sentRelatedDocuments.length + skippedRelatedDocuments.length,
        sentRelatedDocuments,
        skippedRelatedDocuments
      };
    });
  }

  private async listRelatedSignedDocumentsForInvoice(upload: PaymentUploadForExport) {
    if (!upload.monthKey) {
      return [];
    }

    const signedUploads = await this.documentRepository.listLatestSignedSignatureUploadsForCreatorMonth({
      creatorUserId: upload.creatorUserId,
      monthKey: upload.monthKey,
      types: [...INVOICE_RELATED_SIGNED_DOCUMENT_TYPES]
    });

    return compactRelatedSignedDocumentUploads(signedUploads);
  }

  private async formatPaymentDocumentExportCaption(upload: PaymentUploadForExport) {
    const title = getPaymentDocumentTitle(upload.type);
    const amount = await this.resolveInvoiceAmount(upload);

    return [
      'Оплата креатора',
      `${title} за ${upload.monthKey ?? 'период не указан'}`,
      `Креатор: ${formatCreatorDisplayName(upload.creator)}`,
      `Файл: ${upload.originalFileName}`,
      amount === null ? null : `Сумма: ${formatIntegerRu(amount)} рублей`
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatInvoiceRelatedDocumentExportCaption(
    invoiceUpload: PaymentUploadForExport,
    signedUpload: RelatedSignedDocumentUpload
  ) {
    const documentMonth = signedUpload.document.monthKey ? ` (${signedUpload.document.monthKey})` : '';

    return [
      'Документ к счету',
      `Счет за ${invoiceUpload.monthKey ?? 'период не указан'}`,
      `Креатор: ${formatCreatorDisplayName(invoiceUpload.creator)}`,
      `Документ: ${getDocumentTitle(signedUpload.document.type)}${documentMonth}`,
      `Файл: ${signedUpload.originalFileName}`
    ].join('\n');
  }

  private async resolveInvoiceAmount(upload: PaymentUploadForExport) {
    if (!upload.monthKey) {
      return null;
    }

    try {
      const payment = await this.paymentCalculationService.calculateForCreatorMonth(
        upload.creatorUserId,
        upload.monthKey,
        {
          submittedOnly: true,
          persistSnapshot: false
        }
      );

      return isCreatorInvoiceMonth(upload.monthKey)
        ? getCreatorInvoiceDisplayAmount(payment.totalPayment)
        : payment.totalPayment;
    } catch (error) {
      logger.warn(
        {
          error,
          uploadId: upload.id,
          creatorUserId: upload.creatorUserId,
          monthKey: upload.monthKey
        },
        'Could not calculate payment amount for payment document export caption'
      );
      return null;
    }
  }
}
