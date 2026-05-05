import { SocialPlatform } from '@prisma/client';
import { Scenes } from 'telegraf';

import { container } from '../container';
import { replyCreatorPostStatisticsNextStep } from '../creators/creator-statistics-next-step';
import { weeklyPlatformSkipKeyboard } from '../keyboards/inline.keyboards';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import type { BotContext } from '../types/bot-context';
import { formatIntegerRu } from '../utils/formatters';
import { formatPeriodLabel } from '../utils/periods';
import { getMessageText } from '../utils/telegram';
import { formatValidationError } from '../utils/user-errors';
import { kpiViewsSchema, nonNegativeIntSchema, videoCountSchema } from '../validators/stats.schemas';
import { SCENE_IDS } from './scene-ids';

type WeeklyMetric = 'views' | 'likes' | 'comments' | 'reposts' | 'saves';

type CurrentWeeklyItem = {
  platform: SocialPlatform;
  views?: number;
  likes?: number;
  comments?: number;
  reposts?: number;
  saves?: number;
};

type CompleteWeeklyItem = Required<CurrentWeeklyItem>;

type WeeklyWizardState = {
  reportId?: string;
  periodLabel?: string;
  totalVideoCount?: number;
  platformIndex?: number;
  attachmentCount?: number;
  currentItem?: CurrentWeeklyItem;
};

const PLATFORM_ORDER = [
  SocialPlatform.INSTAGRAM,
  SocialPlatform.TIKTOK,
  SocialPlatform.YOUTUBE,
  SocialPlatform.VK
];

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  [SocialPlatform.INSTAGRAM]: 'Instagram',
  [SocialPlatform.TIKTOK]: 'TikTok',
  [SocialPlatform.VK]: 'VK',
  [SocialPlatform.YOUTUBE]: 'YouTube'
};

const METRIC_PROMPTS: Record<WeeklyMetric, string> = {
  views: 'Введи просмотры / охваты за неделю.',
  likes: 'Сколько лайков?',
  comments: 'Сколько комментариев?',
  reposts: 'Сколько репостов?',
  saves: 'Сколько сохранений?'
};

const METRIC_ERROR_MESSAGES: Record<WeeklyMetric, string> = {
  views: 'Введи просмотры / охваты числом.',
  likes: 'Введи лайки числом.',
  comments: 'Введи комментарии числом.',
  reposts: 'Введи репосты числом.',
  saves: 'Введи сохранения числом.'
};

const getState = (ctx: BotContext) => ctx.wizard.state as WeeklyWizardState;

const parseMetricValue = (ctx: BotContext) => nonNegativeIntSchema.parse(getMessageText(ctx.message));
const parseKpiViewsValue = (ctx: BotContext) => kpiViewsSchema.parse(getMessageText(ctx.message));
const parseVideoCount = (ctx: BotContext) => videoCountSchema.parse(getMessageText(ctx.message));

const getCurrentPlatform = (state: WeeklyWizardState) =>
  PLATFORM_ORDER[state.platformIndex ?? 0] ?? PLATFORM_ORDER[PLATFORM_ORDER.length - 1];

const ensureCurrentItem = (state: WeeklyWizardState) => {
  const platform = getCurrentPlatform(state);

  if (!state.currentItem || state.currentItem.platform !== platform) {
    state.currentItem = { platform };
  }

  return state.currentItem;
};

const askCurrentPlatformMetric = async (ctx: BotContext, metric: WeeklyMetric) => {
  const state = getState(ctx);
  const platform = getCurrentPlatform(state);
  const isFirstMetric = metric === 'views';

  await ctx.reply(
    [
      `${PLATFORM_LABELS[platform]}`,
      METRIC_PROMPTS[metric],
      isFirstMetric ? 'Если по этой платформе данных нет, нажми «Пропустить платформу».' : null
    ]
      .filter(Boolean)
      .join('\n'),
    isFirstMetric ? weeklyPlatformSkipKeyboard() : undefined
  );
};

const saveCurrentPlatformStats = async (ctx: BotContext, values: CompleteWeeklyItem) => {
  const state = getState(ctx);

  await container.services.weeklyStatsService.savePlatformStats(state.reportId!, {
    platform: values.platform,
    videoCount: 0,
    views: values.views,
    likes: values.likes,
    comments: values.comments,
    reposts: values.reposts,
    saves: values.saves
  });
};

const saveZeroPlatformStats = async (ctx: BotContext) => {
  const state = getState(ctx);
  const platform = getCurrentPlatform(state);

  await container.services.weeklyStatsService.savePlatformStats(state.reportId!, {
    platform,
    videoCount: 0,
    views: 0,
    likes: 0,
    comments: 0,
    reposts: 0,
    saves: 0
  });
};

const submitAndLeave = async (ctx: BotContext) => {
  const state = getState(ctx);
  const summary = await container.services.weeklyStatsService.submitReport(state.reportId!);
  const attachmentCount = state.attachmentCount ?? summary.attachmentCount;

  await ctx.reply(
    [
      `Недельная статистика сохранена и отправлена за период ${formatPeriodLabel(
        summary.weekStart,
        summary.weekEnd
      )}.`,
      `Видео за неделю: ${formatIntegerRu(summary.totals.videoCount)}.`,
      attachmentCount > 0
        ? `Скрины сохранены: ${formatIntegerRu(attachmentCount)}.`
        : 'Скрины не приложены.',
      'Расчеты будут строиться только по введенным цифрам.'
    ].join('\n'),
    mainMenuKeyboardForUser(ctx.state.currentUser)
  );
  await replyCreatorPostStatisticsNextStep(ctx);
  await ctx.scene.leave();
};

const finishOrAskNextPlatform = async (ctx: BotContext, savedMessage: string) => {
  const state = getState(ctx);
  state.currentItem = undefined;
  state.platformIndex = (state.platformIndex ?? 0) + 1;

  if (state.platformIndex < PLATFORM_ORDER.length) {
    await ctx.reply(savedMessage);
    await askCurrentPlatformMetric(ctx, 'views');
    return ctx.wizard.selectStep(2);
  }

  await ctx.reply(savedMessage);
  return submitAndLeave(ctx);
};

export const weeklyStatsScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.weeklyStats,
  async (ctx) => {
    const report = await container.services.weeklyStatsService.getOrCreateCurrentReport(ctx.state.currentUser!.id);
    const state = getState(ctx);
    state.reportId = report.id;
    state.periodLabel = formatPeriodLabel(
      report.weekStart.toISOString().slice(0, 10),
      report.weekEnd.toISOString().slice(0, 10)
    );
    state.totalVideoCount = report.totalVideoCount ?? undefined;
    state.platformIndex = 0;
    state.attachmentCount = report.attachments.length;
    state.currentItem = undefined;

    await ctx.reply(
      [
        `Заполняем недельную статистику за ${state.periodLabel}.`,
        'Сначала укажи общее количество опубликованных видео за неделю.',
        report.totalVideoCount !== null
          ? `Сейчас сохранено: ${formatIntegerRu(report.totalVideoCount)}. Введи новое число, если нужно обновить отчет.`
          : null
      ]
      .filter(Boolean)
      .join('\n')
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    try {
      const totalVideoCount = parseVideoCount(ctx);
      const state = getState(ctx);
      state.totalVideoCount = totalVideoCount;
      state.platformIndex = 0;
      await container.services.weeklyStatsService.saveTotalVideoCount(state.reportId!, totalVideoCount);
      await ctx.reply(`Количество опубликованных видео за неделю сохранено: ${formatIntegerRu(totalVideoCount)}.`);
      await askCurrentPlatformMetric(ctx, 'views');
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Введи количество опубликованных видео числом.'));
    }
  },
  async (ctx) => {
    const state = getState(ctx);

    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'weekly_platform_skip') {
      await ctx.answerCbQuery();
      await saveZeroPlatformStats(ctx);
      return finishOrAskNextPlatform(ctx, `${PLATFORM_LABELS[getCurrentPlatform(state)]}: данные пропущены, сохранены нули.`);
    }

    try {
      ensureCurrentItem(state).views = parseKpiViewsValue(ctx);
      await askCurrentPlatformMetric(ctx, 'likes');
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, METRIC_ERROR_MESSAGES.views));
    }
  },
  async (ctx) => {
    try {
      ensureCurrentItem(getState(ctx)).likes = parseMetricValue(ctx);
      await askCurrentPlatformMetric(ctx, 'comments');
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, METRIC_ERROR_MESSAGES.likes));
    }
  },
  async (ctx) => {
    try {
      ensureCurrentItem(getState(ctx)).comments = parseMetricValue(ctx);
      await askCurrentPlatformMetric(ctx, 'reposts');
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, METRIC_ERROR_MESSAGES.comments));
    }
  },
  async (ctx) => {
    try {
      ensureCurrentItem(getState(ctx)).reposts = parseMetricValue(ctx);
      await askCurrentPlatformMetric(ctx, 'saves');
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, METRIC_ERROR_MESSAGES.reposts));
    }
  },
  async (ctx) => {
    try {
      const state = getState(ctx);
      const item = ensureCurrentItem(state);
      item.saves = parseMetricValue(ctx);

      await saveCurrentPlatformStats(ctx, item as CompleteWeeklyItem);
      return finishOrAskNextPlatform(ctx, `${PLATFORM_LABELS[item.platform]}: статистика сохранена.`);
    } catch (error) {
      await ctx.reply(formatValidationError(error, METRIC_ERROR_MESSAGES.saves));
    }
  }
);
