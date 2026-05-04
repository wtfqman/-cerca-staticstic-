import { SocialPlatform } from '@prisma/client';
import { Markup, Scenes } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { replyCreatorPostStatisticsNextStep } from '../creators/creator-statistics-next-step';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import { SCENE_IDS } from './scene-ids';
import { formatIntegerRu } from '../utils/formatters';
import { getMonthRange, toDateOnly } from '../utils/periods';
import { getMessageText } from '../utils/telegram';
import { formatValidationError, logUserError } from '../utils/user-errors';
import { kpiViewsSchema } from '../validators/stats.schemas';

const BACKFILL_MONTHS = ['2026-03', '2026-04'] as const;
const BACKFILL_PLATFORM = SocialPlatform.INSTAGRAM;
const REQUIRED_APRIL_SCREENSHOT_COUNT = Object.values(SocialPlatform).length;

type BackfillMonthKey = (typeof BACKFILL_MONTHS)[number];

type MonthlyReachBackfillState = {
  values?: Partial<Record<BackfillMonthKey, number>>;
  aprilReportId?: string;
  aprilScreenshotCount?: number;
};

const getState = (ctx: BotContext) => ctx.wizard.state as MonthlyReachBackfillState;

const parseReach = (ctx: BotContext) => kpiViewsSchema.parse(getMessageText(ctx.message));

const saveMonthlyReachBackfill = async (creatorUserId: string, monthKey: BackfillMonthKey, views: number) => {
  const range = getMonthRange(monthKey);
  const [report, monthlyVideo] = await Promise.all([
    container.repositories.weeklyStatsRepository.findOrCreateReport(
      creatorUserId,
      monthKey,
      toDateOnly(range.dateFrom),
      toDateOnly(range.dateTo)
    ),
    container.services.monthlyVideoService.getMonthCount(creatorUserId, monthKey)
  ]);

  await container.services.weeklyStatsService.saveTotalVideoCount(report.id, monthlyVideo?.videoCount ?? 0);

  await Promise.all(
    Object.values(SocialPlatform).map((platform) =>
      container.services.weeklyStatsService.savePlatformStats(report.id, {
        platform,
        videoCount: 0,
        views: platform === BACKFILL_PLATFORM ? views : 0,
        likes: 0,
        comments: 0,
        reposts: 0,
        saves: 0
      })
    )
  );

  await container.services.weeklyStatsService.submitReport(report.id);

  return report;
};

const skipMarchKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('Пропустить март', 'monthly_reach_backfill_skip_march')]]);

const getScreenshotFile = (ctx: BotContext) => {
  if (!ctx.message) {
    return null;
  }

  if ('photo' in ctx.message && ctx.message.photo.length > 0) {
    return ctx.message.photo[ctx.message.photo.length - 1];
  }

  if ('document' in ctx.message) {
    return ctx.message.document;
  }

  return null;
};

export const monthlyReachMarchAprilScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.monthlyReachMarchApril,
  async (ctx) => {
    getState(ctx).values = {};

    await ctx.reply(
      [
        'Временное закрытие охватов за март и апрель.',
        'Сначала введи общий охват за март 2026. Если за март данных нет, его можно пропустить.',
        'Можно писать с пробелами: например 1 800 000.'
      ].join('\n'),
      skipMarchKeyboard()
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    try {
      if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'monthly_reach_backfill_skip_march') {
        await ctx.answerCbQuery('Март пропущен');
        getState(ctx).values = {};
        await ctx.reply(
          [
            'Март пропускаем.',
            'Теперь введи общий охват за апрель 2026.'
          ].join('\n')
        );
        return ctx.wizard.next();
      }

      const value = parseReach(ctx);
      getState(ctx).values = {
        ...getState(ctx).values,
        [BACKFILL_MONTHS[0]]: value
      };

      await ctx.reply(
        [
          `Март сохраню как ${formatIntegerRu(value)} охватов.`,
          'Теперь введи общий охват за апрель 2026.'
        ].join('\n')
      );

      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Введи охват за март числом.'));
    }
  },
  async (ctx) => {
    try {
      const aprilValue = parseReach(ctx);
      const values = {
        ...getState(ctx).values,
        [BACKFILL_MONTHS[1]]: aprilValue
      };

      if (typeof values[BACKFILL_MONTHS[0]] === 'number') {
        await saveMonthlyReachBackfill(ctx.state.currentUser!.id, BACKFILL_MONTHS[0], values[BACKFILL_MONTHS[0]]!);
      }

      const aprilReport = await saveMonthlyReachBackfill(ctx.state.currentUser!.id, BACKFILL_MONTHS[1], aprilValue);
      getState(ctx).aprilReportId = aprilReport.id;
      getState(ctx).aprilScreenshotCount = aprilReport.attachments.length;

      await ctx.reply(
        [
          'Готово, охваты сохранены:',
          typeof values[BACKFILL_MONTHS[0]] === 'number'
            ? `- 2026-03: ${formatIntegerRu(values[BACKFILL_MONTHS[0]]!)}`
            : '- 2026-03: пропущено',
          `- 2026-04: ${formatIntegerRu(aprilValue)}`,
          'Эти значения будут использоваться в выплатах и отчетах.'
        ].join('\n'),
        getState(ctx).aprilScreenshotCount! < REQUIRED_APRIL_SCREENSHOT_COUNT
          ? undefined
          : mainMenuKeyboardForUser(ctx.state.currentUser)
      );

      if (getState(ctx).aprilScreenshotCount! < REQUIRED_APRIL_SCREENSHOT_COUNT) {
        await ctx.reply(
          `Теперь отправь ${REQUIRED_APRIL_SCREENSHOT_COUNT} скрина статистики за апрель: по одному на каждую соцсеть. Уже сохранено: ${formatIntegerRu(
            getState(ctx).aprilScreenshotCount!
          )}/${formatIntegerRu(REQUIRED_APRIL_SCREENSHOT_COUNT)}.`
        );
        return ctx.wizard.next();
      }

      await replyCreatorPostStatisticsNextStep(ctx);
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'March/April reach backfill failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(
        'Не удалось сохранить охваты за март и апрель. Проверь, что введено число, и попробуй временную кнопку еще раз.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      const state = getState(ctx);
      const file = getScreenshotFile(ctx);

      if (!state.aprilReportId) {
        await ctx.reply('Не вижу апрельский отчет. Открой «Охваты март/апрель» и внеси апрель еще раз.');
        await ctx.scene.leave();
        return;
      }

      if (!file) {
        await ctx.reply('Отправь скрин статистики за апрель фото или файлом.');
        return;
      }

      await container.services.weeklyStatsService.saveAttachment({
        telegram: ctx.telegram,
        reportId: state.aprilReportId,
        creatorUserId: ctx.state.currentUser!.id,
        telegramFileId: file.file_id,
        telegramFileUniqueId: file.file_unique_id
      });
      state.aprilScreenshotCount = await container.services.weeklyStatsService.countAttachments(
        state.aprilReportId
      );

      if (state.aprilScreenshotCount < REQUIRED_APRIL_SCREENSHOT_COUNT) {
        await ctx.reply(
          `Скрин сохранен: ${formatIntegerRu(state.aprilScreenshotCount)}/${formatIntegerRu(
            REQUIRED_APRIL_SCREENSHOT_COUNT
          )}. Отправь следующий скрин за апрель.`
        );
        return;
      }

      await ctx.reply(
        'Все 4 скрина за апрель сохранены. Спасибо.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await replyCreatorPostStatisticsNextStep(ctx);
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'April monthly screenshot save failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply('Не удалось сохранить скрин за апрель. Отправь файл еще раз или нажми /cancel.');
    }
  }
);
