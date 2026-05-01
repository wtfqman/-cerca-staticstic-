import { container } from '../container';
import { formatCreatorSecondQueueScreen } from '../documents/document.formatters';
import {
  creatorSecondQueueActionsKeyboard,
  noContractCreatorPaymentKeyboard
} from '../keyboards/inline.keyboards';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import type { ActiveRosterSecondQueueSummary } from '../services/document-workflow.service';
import type { BotContext } from '../types/bot-context';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';

const hasGeneratedSecondQueueDocuments = (summary: ActiveRosterSecondQueueSummary) =>
  summary.documents.some(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );

const hasAvailableSecondQueueDocuments = (summary: ActiveRosterSecondQueueSummary) =>
  summary.documents.some(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );

export const replyCreatorPostStatisticsNextStep = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser) {
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
      [
        'Статистика сохранена.',
        'Следующий шаг: выставить счет за апрель. Счет за март не нужен.',
        'После оплаты загрузи чек в бот.',
        '',
        formatCreatorSecondQueueScreen(summary)
      ].join('\n'),
      creatorSecondQueueActionsKeyboard({
        isCompleted: true,
        hasGeneratedDocuments: true,
        hasAvailableDocuments: hasAvailableSecondQueueDocuments(summary)
      })
    );
    return;
  }

  if (summary.isFirstQueueCompleted) {
    await ctx.reply(
      [
        'Статистика сохранена.',
        'Дальше нужно закрыть вторую очередь документов: акты и передачу прав.',
        'После подписания второй очереди бот предложит выставить счет только за апрель.'
      ].join('\n'),
      creatorSecondQueueActionsKeyboard({
        isCompleted: false,
        hasGeneratedDocuments: hasGeneratedSecondQueueDocuments(summary),
        hasAvailableDocuments: hasAvailableSecondQueueDocuments(summary)
      })
    );
    return;
  }

  await ctx.reply(
    [
      'Статистика сохранена.',
      'Счет будет только за апрель, но сначала нужно закрыть документы по договору.'
    ].join('\n'),
    mainMenuKeyboardForUser(currentUser)
  );
};
