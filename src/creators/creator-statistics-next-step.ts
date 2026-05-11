import { container } from '../container';
import { CREATOR_INVOICE_MONTH_KEY } from '../documents/document-workflow.constants';
import { formatCreatorSecondQueueScreen } from '../documents/document.formatters';
import {
  creatorFirstQueueActionsKeyboard,
  creatorSecondQueueActionsKeyboard,
  noContractCreatorPaymentKeyboard
} from '../keyboards/inline.keyboards';
import type { ActiveRosterSecondQueueSummary } from '../services/document-workflow.service';
import type { BotContext } from '../types/bot-context';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';
import {
  formatRequiredSecondQueueStatisticsMissingLines,
  getRequiredSecondQueueStatisticsStatus
} from './creator-statistics-requirements';

const hasGeneratedSecondQueueDocuments = (summary: ActiveRosterSecondQueueSummary) =>
  summary.documents.length > 0 &&
  summary.documents.every(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );

const hasAvailableSecondQueueDocuments = (summary: ActiveRosterSecondQueueSummary) =>
  summary.documents.some(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );

const getInvoicePayment = (summary: ActiveRosterSecondQueueSummary) =>
  summary.payments.find((payment) => payment.monthKey === CREATOR_INVOICE_MONTH_KEY);

const formatCompletedSecondQueueNextStep = (summary: ActiveRosterSecondQueueSummary) => {
  const invoicePayment = getInvoicePayment(summary);

  if (invoicePayment?.receiptUploadedAt) {
    return [
      'Статистика сохранена.',
      'Апрельский счет и чек уже загружены.',
      '',
      formatCreatorSecondQueueScreen(summary)
    ].join('\n');
  }

  if (invoicePayment?.invoiceUploadedAt) {
    return [
      'Статистика сохранена.',
      'Счет за апрель уже загружен. После оплаты загрузи чек в бот.',
      '',
      formatCreatorSecondQueueScreen(summary)
    ].join('\n');
  }

  return [
    'Статистика сохранена.',
    'Следующий шаг: выставить счет за апрель. Счет за март не нужен.',
    'После оплаты загрузи чек в бот.',
    '',
    formatCreatorSecondQueueScreen(summary)
  ].join('\n');
};

export const replyCreatorPostStatisticsNextStep = async (
  ctx: BotContext,
  options: { statisticsMonthKey?: string } = {}
) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser) {
    return;
  }

  if (options.statisticsMonthKey && options.statisticsMonthKey !== CREATOR_INVOICE_MONTH_KEY) {
    return;
  }

  const profile = await container.services.creatorProfileService.getProfile(currentUser.id);

  if (isNoContractCreatorProfile(profile)) {
    await ctx.reply(
      [
        'Статистика сохранена.',
        'Теперь выставь счет за апрель. Счет за март не нужен.',
        'После оплаты загрузи чек в бот.'
      ].join('\n'),
      noContractCreatorPaymentKeyboard()
    );
    return;
  }

  const summary = await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(currentUser.id);

  if (summary.isCompleted) {
    await ctx.reply(
      formatCompletedSecondQueueNextStep(summary),
      creatorSecondQueueActionsKeyboard({
        isCompleted: true,
        hasGeneratedDocuments: true,
        hasAvailableDocuments: hasAvailableSecondQueueDocuments(summary)
      })
    );
    return;
  }

  if (summary.isFirstQueueCompleted) {
    const secondQueueKeyboard = creatorSecondQueueActionsKeyboard({
      isCompleted: false,
      hasGeneratedDocuments: hasGeneratedSecondQueueDocuments(summary),
      hasAvailableDocuments: hasAvailableSecondQueueDocuments(summary)
    });
    const statisticsStatus = await getRequiredSecondQueueStatisticsStatus(currentUser.id);

    if (!statisticsStatus.isReady) {
      await ctx.reply(
        [
          'Статистика сохранена.',
          'Перед второй очередью нужно закрыть обязательную статистику за апрель.',
          ...formatRequiredSecondQueueStatisticsMissingLines(statisticsStatus),
          '',
          statisticsStatus.monthlyVideoSubmitted
            ? 'После этого снова нажми «Сформировать вторую очередь».'
            : 'Нажми «Сформировать вторую очередь», и бот сразу попросит ввести количество видео за апрель.'
        ].join('\n'),
        secondQueueKeyboard
      );
      return;
    }

    await ctx.reply(
      [
        'Статистика сохранена.',
        'Дальше нужно закрыть вторую очередь документов: акты и передачу прав.',
        'После подписания второй очереди бот предложит выставить счет только за апрель.'
      ].join('\n'),
      secondQueueKeyboard
    );
    return;
  }

  const firstQueueSummary = await container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(
    currentUser.id
  );
  const hasGeneratedFirstQueueDocuments =
    firstQueueSummary.documents.length > 0 &&
    firstQueueSummary.documents.every((document) => document.status !== 'NOT_GENERATED');
  const hasAvailableFirstQueueDocuments = firstQueueSummary.documents.some((document) => Boolean(document.documentId));

  await ctx.reply(
    [
      'Статистика сохранена.',
      'Счет будет только за апрель, но сначала нужно закрыть документы по договору.',
      'Следующий шаг - первая очередь: договор, NDA и задания.'
    ].join('\n'),
    creatorFirstQueueActionsKeyboard({
      hasGeneratedDocuments: hasGeneratedFirstQueueDocuments,
      hasAvailableDocuments: hasAvailableFirstQueueDocuments
    })
  );
};
