import { PaymentDocumentType } from '@prisma/client';
import fs from 'node:fs';
import type { Telegram } from 'telegraf';
import { Input } from 'telegraf';

import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { isCreatorInvoiceMonth } from '../documents/document-workflow.constants';
import { logger } from '../lib/logger';
import { getCreatorInvoiceDisplayAmount } from '../payments/payment.constants';
import { DocumentWorkflowRepository } from '../repositories/document-workflow.repository';
import { formatCreatorDisplayName, formatIntegerRu } from '../utils/formatters';
import { DocumentWorkflowService } from './document-workflow.service';
import { FileStorageService } from './file-storage.service';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import { PaymentCalculationService } from './payment-calculation.service';

const PAYMENT_DOCUMENT_EXPORT_SEND_DELAY_MS = 1_200;

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

const getPaymentDocumentTitle = (type: PaymentDocumentType) =>
  type === PaymentDocumentType.INVOICE ? 'Счет' : 'Чек';

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

      return {
        type: input.type,
        monthKey: input.monthKey ?? null,
        uploadCount: uploads.length,
        supersededCount: supersededUploads.length,
        sentUploads,
        skippedUploads
      };
    });
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
