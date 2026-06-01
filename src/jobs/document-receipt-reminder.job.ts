import { NotificationType, PaymentDocumentStatus, PaymentDocumentType } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import { container } from '../container';
import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';
import { normalizeErrorForLog } from '../utils/error-logging';
import { formatCreatorDisplayName, formatRussianDate } from '../utils/formatters';
import { isTelegramDirectMessageUnavailableError } from '../utils/telegram-errors';

const isActivePaymentUpload = (status: PaymentDocumentStatus) => status !== PaymentDocumentStatus.REJECTED;

type ReceiptReminderState = Awaited<
  ReturnType<typeof container.services.documentWorkflowService.listReceiptReminderDue>
>[number];

const getReceiptExpectedAtForInvoice = (state: ReceiptReminderState, invoiceUploadedAt: Date, rowValue?: Date | null) => {
  if (rowValue) {
    return rowValue;
  }

  if (state.receiptExpectedAt?.getTime() === invoiceUploadedAt.getTime()) {
    return state.receiptExpectedAt;
  }

  return null;
};

const getReceiptReminderDueAtForInvoice = (state: ReceiptReminderState, invoiceUploadedAt: Date, rowValue?: Date | null) => {
  if (rowValue) {
    return rowValue;
  }

  if (state.receiptExpectedAt?.getTime() === invoiceUploadedAt.getTime()) {
    return state.receiptReminderDueAt;
  }

  return null;
};

const getReceiptReminderSentAtForInvoice = (
  state: ReceiptReminderState,
  invoiceUploadedAt: Date,
  rowValue?: Date | null
) => {
  if (rowValue) {
    return rowValue;
  }

  if (state.receiptExpectedAt?.getTime() === invoiceUploadedAt.getTime()) {
    return state.receiptReminderSentAt;
  }

  return null;
};

const findPendingReceiptInvoice = (
  state: ReceiptReminderState,
  now: Date
) => {
  const invoices = state.paymentUploads
    .filter(
      (upload) => {
        const expectedAt = getReceiptExpectedAtForInvoice(state, upload.uploadedAt, upload.receiptExpectedAt);
        const dueAt = getReceiptReminderDueAtForInvoice(state, upload.uploadedAt, upload.receiptReminderDueAt);
        const sentAt = getReceiptReminderSentAtForInvoice(state, upload.uploadedAt, upload.receiptReminderSentAt);

        return (
          upload.type === PaymentDocumentType.INVOICE &&
          isActivePaymentUpload(upload.status) &&
          Boolean(expectedAt) &&
          Boolean(dueAt) &&
          !sentAt &&
          dueAt!.getTime() <= now.getTime()
        );
      }
    )
    .sort((left, right) => {
      const leftDueAt = getReceiptReminderDueAtForInvoice(state, left.uploadedAt, left.receiptReminderDueAt)!;
      const rightDueAt = getReceiptReminderDueAtForInvoice(state, right.uploadedAt, right.receiptReminderDueAt)!;

      return leftDueAt.getTime() - rightDueAt.getTime();
    });

  return invoices.find(
    (invoice) =>
      !state.paymentUploads.some(
        (upload) =>
          upload.type === PaymentDocumentType.RECEIPT &&
          isActivePaymentUpload(upload.status) &&
          (upload.monthKey ?? null) === (invoice.monthKey ?? null) &&
          upload.uploadedAt >= invoice.uploadedAt
      )
  );
};

const buildReceiptReminderMessage = (invoiceUploadedAt: Date | null, monthKey?: string | null) =>
  [
    monthKey
      ? `Напоминаю, что чек по ${monthKey} еще не загружен.`
      : 'Напоминаю, что после выставления счета нужно загрузить чек.',
    invoiceUploadedAt ? `Счет загружен: ${formatRussianDate(invoiceUploadedAt)}.` : null,
    'Пожалуйста, отправь чек в бот через раздел документов.'
  ]
    .filter(Boolean)
    .join('\n');

export const runDocumentReceiptReminderJob = async (bot: Telegraf<BotContext>) => {
  const now = new Date();
  const dueStates = await container.services.documentWorkflowService.listReceiptReminderDue(now);

  if (dueStates.length === 0) {
    logger.info('Document receipt reminder job skipped: no due reminders');
    return;
  }

  for (const state of dueStates) {
    try {
      const creatorName = formatCreatorDisplayName(state.creator, 'Креатор');
      const pendingInvoice = findPendingReceiptInvoice(state, now);

      if (!pendingInvoice) {
        await container.services.documentWorkflowService.refreshWorkflowState(state.id);
        continue;
      }

      await bot.telegram.sendMessage(
        state.creator.telegramId,
        buildReceiptReminderMessage(pendingInvoice.uploadedAt, pendingInvoice.monthKey)
      );
      await container.services.documentWorkflowService.markReceiptReminderSent(
        state.id,
        new Date(),
        pendingInvoice.id
      );
      await container.repositories.notificationRepository.create(
        state.creatorUserId,
        NotificationType.DOCUMENT_RECEIPT_REMINDER,
        {
          workflowStateId: state.id,
          campaignId: state.campaignId,
          campaignKey: state.campaign.key,
          paymentUploadId: pendingInvoice.id,
          monthKey: pendingInvoice.monthKey,
          invoiceUploadedAt: pendingInvoice.uploadedAt,
          receiptExpectedAt: getReceiptExpectedAtForInvoice(
            state,
            pendingInvoice.uploadedAt,
            pendingInvoice.receiptExpectedAt
          ),
          receiptReminderDueAt: getReceiptReminderDueAtForInvoice(
            state,
            pendingInvoice.uploadedAt,
            pendingInvoice.receiptReminderDueAt
          )
        }
      );

      logger.info(
        {
          workflowStateId: state.id,
          creatorUserId: state.creatorUserId,
          creatorName
        },
        'Document receipt reminder sent'
      );
    } catch (error) {
      if (isTelegramDirectMessageUnavailableError(error)) {
        logger.warn(
          {
            error: normalizeErrorForLog(error),
            workflowStateId: state.id,
            creatorUserId: state.creatorUserId,
            telegramId: state.creator.telegramId
          },
          'Document receipt reminder skipped: Telegram direct message unavailable'
        );
        continue;
      }

      logger.error(
        {
          error: normalizeErrorForLog(error),
          workflowStateId: state.id,
          creatorUserId: state.creatorUserId,
          telegramId: state.creator.telegramId
        },
        'Document receipt reminder failed'
      );
    }
  }
};
