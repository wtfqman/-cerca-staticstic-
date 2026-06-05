import { UserRole } from '@prisma/client';
import { Markup, type Telegraf } from 'telegraf';

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
  getRequiredSecondQueueMonthKey,
  getRequiredSecondQueueStatisticsStatus,
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

const creatorStatsActionKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('Внести статистику за 7 дней', 'creator_weekly_stats_start')]]);

const ensureRequiredStatisticsReadyForSecondQueue = async (ctx: BotContext) => {
  const creatorUserId = ctx.state.currentUser!.id;
  const status = await getRequiredSecondQueueStatisticsStatus(creatorUserId);
  const monthKey = getRequiredSecondQueueMonthKey();

  if (status.isReady) {
    return true;
  }

  const missingLines = formatRequiredSecondQueueStatisticsMissingLines(status);

  await ctx.reply(
    [
      `Перед второй очередью нужно закрыть обязательную статистику за ${monthKey}.`,
      ...missingLines,
      '',
      status.monthlyVideoSubmitted
        ? 'После этого снова нажми «Сформировать вторую очередь».'
        : `Сейчас открою ввод количества видео за ${monthKey}. После сохранения снова нажми «Сформировать вторую очередь».`
    ]
      .filter(Boolean)
      .join('\n')
  );

  if (!status.monthlyVideoSubmitted) {
    await ctx.scene.enter(SCENE_IDS.monthlyVideo, {
      monthKey,
      force: true
    });
  }

  return false;
};

export const registerCreatorHandlers = (bot: Telegraf<BotContext>) => {
  bot.hears(CREATOR_MENU.profile, roleGuard(UserRole.CREATOR), handleProfile);

  bot.hears(CREATOR_MENU.socialLinks, roleGuard(UserRole.CREATOR), async (ctx) => {
    await ctx.scene.enter(SCENE_IDS.creatorSocialLinks);
  });

  bot.hears(CREATOR_MENU.dailyPublication, roleGuard(UserRole.CREATOR), async (ctx) => {
    try {
      const result = await container.services.dailyCheckService.confirmToday(ctx.state.currentUser!.id);

      await ctx.reply(
        result.alreadyConfirmed
          ? 'Выкладка за сегодня уже подтверждена.'
          : 'Готово, зафиксировал: видео за сегодня выложено.'
      );
    } catch (error) {
      logUserError(error, 'Daily publication menu confirmation failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(
        formatUserError(
          error,
          'Сейчас не удалось сохранить подтверждение выкладки. Попробуй еще раз немного позже.'
        )
      );
    }
  });

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
      ].join('\n'),
      creatorStatsActionKeyboard()
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


    await ctx.scene.enter(SCENE_IDS.weeklyStats);
  });

  bot.action('creator_weekly_stats_start', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await safeAnswerCbQuery(ctx, 'Открываю недельную статистику...');
    await ctx.scene.enter(SCENE_IDS.weeklyStats);
  });

  bot.hears(CREATOR_MENU.monthlyVideos, roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
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
    await ctx.scene.enter(SCENE_IDS.signedDocumentUpload);
  });

  bot.action('document_upload_start', roleGuard(UserRole.CREATOR), async (ctx) => {
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

    await safeAnswerCbQuery(ctx, 'Формирую документы...');

    try {
      await container.services.documentService.generateMonthlyDocuments(ctx.state.currentUser!.id, monthKey, ctx.telegram);
      await ctx.reply(`Документы за ${monthKey} сформированы и отправлены тебе в чат. Их можно открыть в разделе "Мои документы".`);
    } catch (error) {
      logUserError(error, 'Monthly document generation failed', {
        userId: ctx.state.currentUser?.id,
        monthKey
      });
      await ctx.reply(
        [
          `Не удалось сформировать документы за ${monthKey}.`,
          formatUserError(
            error,
            'Сейчас документы не удалось сформировать автоматически. Попробуй позже или сообщи администратору.'
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

    await safeAnswerCbQuery(ctx, 'Проверяю первую очередь...');
    await ctx.reply('Принял. Проверяю и при необходимости формирую первую очередь. Это может занять 1-2 минуты.');

    void (async () => {
      try {
        await openCreatorFirstQueueEntryFlow(ctx, { autoGenerate: true, showMenu: false });
      } catch (error) {
        logUserError(error, 'Active roster first queue generation failed', {
          userId: ctx.state.currentUser?.id
        });
        await ctx.reply(
          formatUserError(
            error,
            'Сейчас не удалось сформировать или отправить первую очередь. Попробуй позже или сообщи администратору.'
          )
        );
      } finally {
        finishDocumentGenerationAction(sendKey);
      }
    })();
  });

  bot.action('document_generate_second_queue', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (!(await ensureRequiredStatisticsReadyForSecondQueue(ctx))) {
      await safeAnswerCbQuery(ctx);
      return;
    }

    const sendKey = `${ctx.state.currentUser!.id}:generate_second_queue`;

    if (!startDocumentGenerationAction(sendKey)) {
      await safeAnswerCbQuery(ctx, 'Уже отправляю комплект...');
      return;
    }

    await safeAnswerCbQuery(ctx, 'Формирую вторую очередь...');
    await ctx.reply('Принял. Формирую задание, акт и акт передачи прав на 1000 руб. Это может занять 1-2 минуты.');

    void (async () => {
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
            'Отправил вторую очередь документов: задание, акт и акт передачи прав на 1000 руб.',
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
          formatUserError(
            error,
            'Вторая очередь не отправлена. Проверь, что первая очередь подписана, статистика закрыта, а шаблоны и данные проходят проверку.'
          )
        );
      } finally {
        finishDocumentGenerationAction(sendKey);
      }
    })();
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
