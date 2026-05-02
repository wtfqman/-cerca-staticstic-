import { UserRole } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { CREATOR_MENU } from '../keyboards/menu-labels';
import { roleGuard } from '../middlewares/role-guard.middleware';
import { handleCreatorWeekReport, handleProfile } from '../handlers/common.handlers';
import { SCENE_IDS } from '../scenes/scene-ids';
import {
  creatorSecondQueueActionsKeyboard,
  creatorReportsKeyboard,
} from '../keyboards/inline.keyboards';
import { formatAggregationSnapshot, formatCreatorMonthlyReport } from '../reports/report.formatters';
import { getCurrentMonthKey, getPreviousMonthKey } from '../utils/periods';
import { formatTeamLeadDisplayName } from '../utils/formatters';
import { formatUserError, logUserError } from '../utils/user-errors';
import {
  ensureCreatorProfileCompletedForDocuments,
  openCreatorFirstQueueEntryFlow,
  openCreatorDocumentsFlow
} from './creator-documents.flow';
import { canUseAdminScenario, canUseCreatorScenario } from '../utils/access';
import { isMarchAprilStatisticsScenario } from '../utils/creator-statistics-scenario';
import { safeAnswerCbQuery } from '../utils/telegram-callback';
import {
  formatRequiredSecondQueueStatisticsMissingLines,
  getRequiredSecondQueueStatisticsStatus,
  REQUIRED_SECOND_QUEUE_MONTH_KEY
} from './creator-statistics-requirements';

const DOCUMENT_GENERATION_DEDUPE_MS = 15_000;
const activeDocumentGenerationKeys = new Set<string>();
const recentDocumentGenerationAt = new Map<string, number>();

const startDocumentGenerationAction = (key: string) => {
  const now = Date.now();
  const recentAt = recentDocumentGenerationAt.get(key);

  if (activeDocumentGenerationKeys.has(key) || (recentAt && now - recentAt < DOCUMENT_GENERATION_DEDUPE_MS)) {
    return false;
  }

  activeDocumentGenerationKeys.add(key);
  return true;
};

const finishDocumentGenerationAction = (key: string) => {
  activeDocumentGenerationKeys.delete(key);
  recentDocumentGenerationAt.set(key, Date.now());
  const cleanupTimer = setTimeout(
    () => recentDocumentGenerationAt.delete(key),
    DOCUMENT_GENERATION_DEDUPE_MS
  );
  (cleanupTimer as { unref?: () => void }).unref?.();
};

const weeklyStatusTextMap: Record<string, string> = {
  DRAFT: 'черновик',
  SUBMITTED: 'отправлен',
  CONFIRMED: 'подтвержден'
};

const formatWeeklyReviewText = (summary: { status: string; isReviewedByTeamLead: boolean }) => {
  if (summary.isReviewedByTeamLead) {
    return 'проверено тимлидом';
  }

  if (summary.status === 'SUBMITTED' || summary.status === 'CONFIRMED') {
    return 'ожидает проверки тимлидом';
  }

  return 'еще не отправлено';
};

const ensureAprilStatisticsReadyForSecondQueue = async (ctx: BotContext) => {
  const creatorUserId = ctx.state.currentUser!.id;
  const status = await getRequiredSecondQueueStatisticsStatus(creatorUserId);

  if (status.isReady) {
    return true;
  }

  const missingLines = formatRequiredSecondQueueStatisticsMissingLines(status);

  await ctx.reply(
    [
      'Перед второй очередью нужно закрыть обязательную статистику за апрель.',
      ...missingLines,
      '',
      status.monthlyVideoSubmitted
        ? 'После этого снова нажми «Сформировать вторую очередь».'
        : 'Сейчас открою ввод количества видео за апрель. После сохранения снова нажми «Сформировать вторую очередь».'
    ]
      .filter(Boolean)
      .join('\n')
  );

  if (!status.monthlyVideoSubmitted) {
    await ctx.scene.enter(SCENE_IDS.monthlyVideo, {
      monthKey: REQUIRED_SECOND_QUEUE_MONTH_KEY,
      force: true
    });
  }

  return false;
};

export const registerCreatorHandlers = (bot: Telegraf<BotContext>) => {
  bot.hears(CREATOR_MENU.profile, roleGuard(UserRole.CREATOR), handleProfile);

  bot.hears(CREATOR_MENU.stats, async (ctx, next) => {
    if (canUseAdminScenario(ctx.state.currentUser) || !canUseCreatorScenario(ctx.state.currentUser)) {
      return next();
    }

    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const creatorUserId = ctx.state.currentUser!.id;
    const monthKey = getCurrentMonthKey();
    const [weeklySummary, monthlyVideo, pendingDocuments, activeTeamLeadLink] = await Promise.all([
      container.services.weeklyStatsService.getCurrentWeeklySummary(creatorUserId),
      container.services.monthlyVideoService.getMonthCount(creatorUserId, monthKey),
      container.services.documentService.listPendingSignatureDocuments(creatorUserId),
      container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId)
    ]);

    await ctx.reply(
      [
        `Статус по работе за ${monthKey}`,
        '',
        `Недельный отчет ${weeklySummary.weekStart} - ${weeklySummary.weekEnd}: ${
          weeklyStatusTextMap[weeklySummary.status] ?? weeklySummary.status
        }`,
        `Проверка тимлидом: ${formatWeeklyReviewText(weeklySummary)}`,
        `Видео за неделю: ${weeklySummary.totals.videoCount.toLocaleString('ru-RU')}`,
        `Скрины к недельному отчету: ${
          weeklySummary.attachmentCount > 0 ? weeklySummary.attachmentCount.toLocaleString('ru-RU') : 'не приложены'
        }`,
        `Платформ в отчете: ${weeklySummary.items.length}`,
        `Количество видео за ${monthKey}: ${
          monthlyVideo ? monthlyVideo.videoCount.toLocaleString('ru-RU') : 'не указано'
        }`,
        `Документы, ожидающие подпись: ${pendingDocuments.length.toLocaleString('ru-RU')}`,
        `Тимлид: ${
          activeTeamLeadLink ? formatTeamLeadDisplayName(activeTeamLeadLink.teamLead) : 'пока не назначен'
        }`
      ].join('\n')
    );
    await ctx.reply(
      formatAggregationSnapshot(
        'Сводка за последние 7 дней',
        await container.services.creatorReportService.getLastSevenDaysSummary(creatorUserId)
      )
    );
  });

  bot.hears(CREATOR_MENU.weeklyStats, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (isMarchAprilStatisticsScenario(ctx.state.currentUser)) {
      await ctx.reply('Для твоего сценария сейчас нужно закрыть март и апрель через кнопки «Видео за март и апрель» и «Охваты март/апрель».');
      return;
    }

    await ctx.scene.enter(SCENE_IDS.weeklyStats);
  });

  bot.hears(CREATOR_MENU.monthlyVideos, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (isMarchAprilStatisticsScenario(ctx.state.currentUser)) {
      await ctx.reply('Для твоего сценария сейчас нужно закрыть март и апрель через кнопку «Видео за март и апрель».');
      return;
    }

    await ctx.scene.enter(SCENE_IDS.monthlyVideo);
  });

  bot.action(/^creator_monthly_video_reminder:(.+)$/, roleGuard(UserRole.CREATOR), async (ctx) => {
    const monthKey = ctx.match[1];

    await safeAnswerCbQuery(ctx, 'Открываю ввод количества видео...');
    await ctx.scene.enter(SCENE_IDS.monthlyVideo, {
      monthKey,
      force: true
    });
  });

  bot.hears(CREATOR_MENU.monthlyVideosMarchApril, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (!isMarchAprilStatisticsScenario(ctx.state.currentUser)) {
      await ctx.reply('Для твоего сценария используй обычную кнопку «Указать количество видео за месяц».');
      return;
    }

    await ctx.scene.enter(SCENE_IDS.monthlyVideoMarchApril);
  });

  bot.hears(CREATOR_MENU.monthlyReachMarchApril, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (!isMarchAprilStatisticsScenario(ctx.state.currentUser)) {
      await ctx.reply('Для твоего сценария используй обычную кнопку «Внести статистику за 7 дней».');
      return;
    }

    await ctx.scene.enter(SCENE_IDS.monthlyReachMarchApril);
  });

  bot.hears(CREATOR_MENU.reports, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await ctx.reply(
      'Выбери нужный отчет.',
      creatorReportsKeyboard(getCurrentMonthKey(), getPreviousMonthKey())
    );
  });

  bot.hears(CREATOR_MENU.documents, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await openCreatorDocumentsFlow(ctx);
  });

  bot.hears(CREATOR_MENU.uploadSigned, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await ctx.scene.enter(SCENE_IDS.signedDocumentUpload);
  });

  bot.action('document_upload_start', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx);
    await ctx.scene.enter(SCENE_IDS.signedDocumentUpload);
  });

  bot.action('payment_invoice_upload_start', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx);
    await ctx.scene.enter(SCENE_IDS.paymentDocumentUpload, { type: 'INVOICE' });
  });

  bot.action('payment_receipt_upload_start', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx);
    await ctx.scene.enter(SCENE_IDS.paymentDocumentUpload, { type: 'RECEIPT' });
  });

  bot.action(/^creator_month_report:(.+)$/, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const monthKey = ctx.match[1];
    const report = await container.services.creatorReportService.getMonthlyReport(ctx.state.currentUser!.id, monthKey);
    await safeAnswerCbQuery(ctx);
    await ctx.reply(formatCreatorMonthlyReport(report));
  });

  bot.action('creator_week_report', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx);
    await handleCreatorWeekReport(ctx);
  });

  bot.action(/^document_generate_month:(.+)$/, roleGuard(UserRole.CREATOR), async (ctx) => {
    const monthKey = ctx.match[1];

    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx, 'Формирую задание...');

    try {
      await container.services.documentService.generateMonthlyDocuments(ctx.state.currentUser!.id, monthKey, ctx.telegram);
      await ctx.reply(`Задание за ${monthKey} сформировано и отправлено тебе в чат. Его можно открыть в разделе "Мои документы".`);
    } catch (error) {
      logUserError(error, 'Monthly document generation failed', {
        userId: ctx.state.currentUser?.id,
        monthKey
      });
      await ctx.reply(
        [
          `Не удалось сформировать задание за ${monthKey}.`,
          formatUserError(
            error,
            'Сейчас задание не удалось сформировать автоматически. Попробуй позже или сообщи администратору.'
          )
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
  });

  bot.action('document_generate_first_queue', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const sendKey = `${ctx.state.currentUser!.id}:generate_first_queue`;

    if (!startDocumentGenerationAction(sendKey)) {
      await safeAnswerCbQuery(ctx, 'Уже отправляю комплект...');
      return;
    }

    try {
      await safeAnswerCbQuery(ctx, 'Проверяю первую очередь...');
      await openCreatorFirstQueueEntryFlow(ctx, { showMenu: false });
    } finally {
      finishDocumentGenerationAction(sendKey);
    }
  });

  bot.action('document_generate_second_queue', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (!(await ensureAprilStatisticsReadyForSecondQueue(ctx))) {
      await safeAnswerCbQuery(ctx);
      return;
    }

    const sendKey = `${ctx.state.currentUser!.id}:generate_second_queue`;

    if (!startDocumentGenerationAction(sendKey)) {
      await safeAnswerCbQuery(ctx, 'Уже отправляю комплект...');
      return;
    }

    await safeAnswerCbQuery(ctx, 'Формирую вторую очередь...');

    try {
      const documents = await container.services.documentService.generateActiveRosterResigningSecondQueueDocuments(
        ctx.state.currentUser!.id,
        ctx.telegram
      );
      const summary = await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(
        ctx.state.currentUser!.id
      );
      const hasGeneratedDocuments =
        summary.documents.length > 0 &&
        summary.documents.every((document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED');

      await ctx.reply(
        [
          'Отправил вторую очередь документов: акты и передачу прав.',
          'Подпиши PDF и отправь подписанные файлы обратно в бот.'
        ].join('\n'),
        creatorSecondQueueActionsKeyboard({
          isCompleted: summary.isCompleted,
          hasGeneratedDocuments,
          hasAvailableDocuments: documents.length > 0
        })
      );
    } catch (error) {
      logUserError(error, 'Active roster second queue generation failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(
        'Вторая очередь не отправлена. Сначала первая очередь должна быть подписана, а шаблоны и данные должны пройти проверку.'
      );
    } finally {
      finishDocumentGenerationAction(sendKey);
    }
  });

  const openProfileChangeRequest = async (ctx: BotContext) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx);
    await ctx.scene.enter(SCENE_IDS.profileChangeRequest);
  };

  bot.action('profile_change_request_start', roleGuard(UserRole.CREATOR), openProfileChangeRequest);
  bot.action('profile_edit_open', roleGuard(UserRole.CREATOR), openProfileChangeRequest);
};
