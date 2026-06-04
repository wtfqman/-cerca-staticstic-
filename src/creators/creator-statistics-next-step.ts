import { container } from '../container';
import { getCreatorInvoiceMonthKey } from '../documents/document-workflow.constants';
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
  summary.payments.find((payment) => payment.monthKey === getCreatorInvoiceMonthKey());

const formatCompletedSecondQueueNextStep = (summary: ActiveRosterSecondQueueSummary) => {
  const invoicePayment = getInvoicePayment(summary);
  const monthKey = getCreatorInvoiceMonthKey();

  if (invoicePayment?.receiptUploadedAt) {
    return [
      'Статистика сохранена.',
      `Счет и чек за ${monthKey} уже загружены.`,
      '',
      formatCreatorSecondQueueScreen(summary)
    ].join('\n');
  }

  if (invoicePayment?.invoiceUploadedAt) {
    return [
      'Статистика сохранена.',
      `Счет за ${monthKey} уже загружен. Теперь сразу нужен чек: без него бот не передаст документы дальше.`,
      '',
      formatCreatorSecondQueueScreen(summary)
    ].join('\n');
  }

  return [
    'Статистика сохранена.',
    `Следующий шаг: выставить счет за ${monthKey}.`,
    'После счета сразу загрузи чек в бот: без чека сценарий не двинется дальше.',
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

  const invoiceMonthKey = getCreatorInvoiceMonthKey();

  if (options.statisticsMonthKey && options.statisticsMonthKey !== invoiceMonthKey) {
    return;
  }

  const profile = await container.services.creatorProfileService.getProfile(currentUser.id);

  if (isNoContractCreatorProfile(profile)) {
    await ctx.reply(
      [
        'Статистика сохранена.',
        `Теперь выставь счет за ${invoiceMonthKey}.`,
        'После счета сразу загрузи чек в бот: без чека сценарий не двинется дальше.'
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
          `Перед второй очередью нужно закрыть обязательную статистику за ${statisticsStatus.monthKey}.`,
          ...formatRequiredSecondQueueStatisticsMissingLines(statisticsStatus),
          '',
          statisticsStatus.monthlyVideoSubmitted
            ? 'После этого снова нажми «Сформировать вторую очередь».'
            : `Нажми «Сформировать вторую очередь», и бот сразу попросит ввести количество видео за ${statisticsStatus.monthKey}.`
        ].join('\n'),
        secondQueueKeyboard
      );
      return;
    }

    await ctx.reply(
      [
        'Статистика сохранена.',
        'Дальше нужно закрыть вторую очередь документов: задание, акт и акт на 1000 руб.',
        `После подписания второй очереди бот предложит выставить счет за ${invoiceMonthKey}.`
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
      `Счет будет за ${invoiceMonthKey}, но сначала нужно закрыть документы по договору.`,
      'Следующий шаг - первая очередь: договор и NDA.'
    ].join('\n'),
    creatorFirstQueueActionsKeyboard({
      hasGeneratedDocuments: hasGeneratedFirstQueueDocuments,
      hasAvailableDocuments: hasAvailableFirstQueueDocuments
    })
  );
};
