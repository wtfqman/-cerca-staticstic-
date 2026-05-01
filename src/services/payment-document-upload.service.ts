import { PaymentDocumentType } from '@prisma/client';
import type { Telegram } from 'telegraf';

import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { DocumentWorkflowService } from './document-workflow.service';
import { FileStorageService } from './file-storage.service';

export class PaymentDocumentUploadService {
  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly documentWorkflowService: DocumentWorkflowService
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
}
