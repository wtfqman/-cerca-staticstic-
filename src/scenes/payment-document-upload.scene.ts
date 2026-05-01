import { Scenes } from 'telegraf';

import { formatCreatorInvoiceAmountHint, formatCreatorSecondQueueScreen } from '../documents/document.formatters';
import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { container } from '../container';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import { paymentInvoiceMonthKeyboard, paymentReceiptMonthKeyboard } from '../keyboards/inline.keyboards';
import type { BotContext } from '../types/bot-context';
import { formatUserError, logUserError } from '../utils/user-errors';
import { SCENE_IDS } from './scene-ids';
import { ensureCreatorProfileCompletedForDocuments } from '../creators/creator-documents.flow';
import {
  CREATOR_INVOICE_MONTH_KEY,
  NO_CONTRACT_PAYMENT_CAMPAIGN_KEY,
  filterCreatorInvoiceMonths
} from '../documents/document-workflow.constants';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';

type PaymentUploadType = 'INVOICE' | 'RECEIPT';

type PaymentUploadSceneState = {
  type?: PaymentUploadType;
  monthKey?: string;
  campaignKey?: string;
};

const getState = (ctx: BotContext) => ctx.wizard.state as PaymentUploadSceneState;
const getUploadType = (ctx: BotContext): PaymentUploadType => getState(ctx).type ?? 'INVOICE';
const getAvailablePaymentMonths = (monthKeys: string[]) => {
  const filtered = filterCreatorInvoiceMonths(monthKeys);

  return filtered.length > 0 ? filtered : [CREATOR_INVOICE_MONTH_KEY];
};

export const paymentDocumentUploadScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.paymentDocumentUpload,
  async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const uploadType = getUploadType(ctx);
    const profile = await container.services.creatorProfileService.getProfile(ctx.state.currentUser!.id);
    const isNoContract = isNoContractCreatorProfile(profile);

    if (isNoContract) {
      const state = await container.services.documentWorkflowService.prepareNoContractPaymentWorkflow(
        ctx.state.currentUser!.id
      );
      const monthKeys = state.campaign.periodMonths as unknown;
      const periodMonths = Array.isArray(monthKeys)
        ? monthKeys.filter((monthKey): monthKey is string => typeof monthKey === 'string')
        : ['2026-04'];
      const availablePaymentMonths = getAvailablePaymentMonths(periodMonths);

      getState(ctx).campaignKey = NO_CONTRACT_PAYMENT_CAMPAIGN_KEY;

      await ctx.reply(
        uploadType === 'INVOICE'
          ? 'Для твоего сценария договорные документы не нужны. Выбери месяц, за который загружаешь счет.'
          : 'Выбери месяц, за который загружаешь чек.',
        uploadType === 'INVOICE'
          ? paymentInvoiceMonthKeyboard(availablePaymentMonths)
          : paymentReceiptMonthKeyboard(availablePaymentMonths)
      );
      return ctx.wizard.next();
    }

    const summary = await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(
      ctx.state.currentUser!.id
    );

    await ctx.reply(formatCreatorSecondQueueScreen(summary));

    if (!summary.isFirstQueueCompleted) {
      await ctx.reply(
        'Сначала нужно закрыть первую очередь документов, затем можно будет перейти ко второй очереди, счету и чеку.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
      return;
    }

    if (!summary.periodMonths.length) {
      await ctx.reply(
        'Не вижу периодов для загрузки счета. Сообщи администратору.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
      return;
    }

    const availablePaymentMonths = getAvailablePaymentMonths(summary.periodMonths);

    await ctx.reply(
      uploadType === 'INVOICE'
        ? 'Выбери месяц, за который загружаешь счет. Счет доступен только после подписанных документов второй очереди за этот же месяц.'
        : 'Выбери месяц, за который загружаешь чек. Чек доступен после загруженного счета за этот же месяц.',
      uploadType === 'INVOICE'
        ? paymentInvoiceMonthKeyboard(availablePaymentMonths)
        : paymentReceiptMonthKeyboard(availablePaymentMonths)
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const uploadType = getUploadType(ctx);
    const expectedPrefix = uploadType === 'INVOICE' ? 'payment_invoice_month:' : 'payment_receipt_month:';

    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data.startsWith(expectedPrefix)) {
      const monthKey = ctx.callbackQuery.data.split(':')[1];
      getState(ctx).monthKey = monthKey;
      await ctx.answerCbQuery();

      const access =
        uploadType === 'INVOICE'
          ? await container.services.documentWorkflowService.canUploadInvoice(
              ctx.state.currentUser!.id,
              monthKey,
              getState(ctx).campaignKey
            )
          : await container.services.documentWorkflowService.canUploadReceipt(
              ctx.state.currentUser!.id,
              monthKey,
              getState(ctx).campaignKey
            );

      if (!access.allowed) {
        await ctx.reply(access.reason, mainMenuKeyboardForUser(ctx.state.currentUser));
        await ctx.scene.leave();
        return;
      }

      const invoiceAmountHint = uploadType === 'INVOICE'
        ? formatCreatorInvoiceAmountHint(
            getState(ctx).campaignKey === NO_CONTRACT_PAYMENT_CAMPAIGN_KEY
              ? {
                  monthKey,
                  secondQueueSigned: true,
                  totalPayment: (
                    await container.services.paymentCalculationService.calculateForCreatorMonth(
                      ctx.state.currentUser!.id,
                      monthKey,
                      { persistSnapshot: false }
                    )
                  ).totalPayment
                }
              : (await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(
                  ctx.state.currentUser!.id
                )).payments.find((payment) => payment.monthKey === monthKey) ?? {
                  monthKey,
                  secondQueueSigned: true
                }
          )
        : null;

      await ctx.reply(
        uploadType === 'INVOICE'
          ? [
              `Отправь PDF-файл счета за ${monthKey} одним документом.`,
              invoiceAmountHint,
              'Если передумал, нажми /cancel.'
            ].filter(Boolean).join('\n')
          : `Отправь PDF-файл чека за ${monthKey} одним документом. Если передумал, нажми /cancel.`
      );
      return ctx.wizard.next();
    }

    await ctx.reply('Сначала выбери месяц кнопкой.');
  },
  async (ctx) => {
    const uploadType = getUploadType(ctx);
    const monthKey = getState(ctx).monthKey;

    if (!monthKey) {
      await ctx.reply(
        'Не вижу выбранный месяц. Начни загрузку финансового файла заново из раздела документов.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
      return;
    }

    if (!ctx.message || !('document' in ctx.message)) {
      await ctx.reply(
        uploadType === 'INVOICE'
          ? 'Жду PDF-файл счета именно как документ. Если нужно выйти без загрузки, нажми /cancel.'
          : 'Жду PDF-файл чека именно как документ. Если нужно выйти без загрузки, нажми /cancel.'
      );
      return;
    }

    if (!isPdfTelegramDocument(ctx.message.document)) {
      await ctx.reply(
        uploadType === 'INVOICE'
          ? 'Нужен именно PDF-файл счета. Отправь документ с расширением .pdf.'
          : 'Нужен именно PDF-файл чека. Отправь документ с расширением .pdf.'
      );
      return;
    }

    try {
      if (uploadType === 'INVOICE') {
        await container.services.paymentDocumentUploadService.acceptInvoicePdf({
          telegram: ctx.telegram,
          creatorUserId: ctx.state.currentUser!.id,
          monthKey,
          campaignKey: getState(ctx).campaignKey,
          telegramFileId: ctx.message.document.file_id,
          telegramDocumentId: ctx.message.document.file_unique_id,
          originalFileName: ctx.message.document.file_name ?? `invoice_${monthKey}.pdf`,
          mimeType: ctx.message.document.mime_type
        });
      } else {
        await container.services.paymentDocumentUploadService.acceptReceiptPdf({
          telegram: ctx.telegram,
          creatorUserId: ctx.state.currentUser!.id,
          monthKey,
          campaignKey: getState(ctx).campaignKey,
          telegramFileId: ctx.message.document.file_id,
          telegramDocumentId: ctx.message.document.file_unique_id,
          originalFileName: ctx.message.document.file_name ?? `receipt_${monthKey}.pdf`,
          mimeType: ctx.message.document.mime_type
        });
      }

      await ctx.reply(
            uploadType === 'INVOICE'
                ? [
                    `Счет за ${monthKey} получен и сохранен.`,
                    'Теперь по этому периоду система будет ждать чек.',
                    'После оплаты загрузи чек в бот кнопкой «Загрузить чек».'
                ].join('\n')
                : [
                    `Чек за ${monthKey} получен и сохранен.`,
              'Ожидание чека по этому периоду закрыто.'
            ].join('\n'),
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'Payment invoice upload failed', {
        userId: ctx.state.currentUser?.id,
        monthKey,
        uploadType
      });
      await ctx.reply(
        formatUserError(
          error,
          uploadType === 'INVOICE'
            ? 'Сейчас не удалось принять счет. Попробуй еще раз немного позже или сообщи администратору.'
            : 'Сейчас не удалось принять чек. Попробуй еще раз немного позже или сообщи администратору.'
        )
      );
    }
  }
);
