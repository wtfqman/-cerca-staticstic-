import { Markup, Scenes } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { replyCreatorPostStatisticsNextStep } from '../creators/creator-statistics-next-step';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import { SCENE_IDS } from './scene-ids';
import { videoCountSchema } from '../validators/stats.schemas';
import { getMessageText } from '../utils/telegram';
import { formatValidationError, logUserError } from '../utils/user-errors';

const BACKFILL_MONTHS = ['2026-03', '2026-04'] as const;

type BackfillMonthKey = (typeof BACKFILL_MONTHS)[number];

type MonthlyVideoBackfillState = {
  values?: Partial<Record<BackfillMonthKey, number>>;
};

const getState = (ctx: BotContext) => ctx.wizard.state as MonthlyVideoBackfillState;

const getExistingText = async (creatorUserId: string, monthKey: BackfillMonthKey) => {
  const existing = await container.services.monthlyVideoService.getMonthCount(creatorUserId, monthKey);

  return existing
    ? `Сейчас за ${monthKey} сохранено: ${existing.videoCount}. Введи новое число, если нужно обновить.`
    : `За ${monthKey} число видео еще не указано. Введи количество видео.`;
};

const parseVideoCount = (ctx: BotContext) => videoCountSchema.parse(getMessageText(ctx.message));

const skipMarchKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('Пропустить март', 'monthly_video_backfill_skip_march')]]);

export const monthlyVideoMarchAprilScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.monthlyVideoMarchApril,
  async (ctx) => {
    getState(ctx).values = {};

    await ctx.reply(
      [
        'Временное закрытие марта и апреля.',
        'Сначала внесем количество видео за март. Если за март данных нет, его можно пропустить.',
        await getExistingText(ctx.state.currentUser!.id, BACKFILL_MONTHS[0])
      ].join('\n'),
      skipMarchKeyboard()
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    try {
      if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'monthly_video_backfill_skip_march') {
        await ctx.answerCbQuery('Март пропущен');
        getState(ctx).values = {};
        await ctx.reply(
          [
            'Март пропускаем.',
            'Теперь введи количество видео за апрель.',
            await getExistingText(ctx.state.currentUser!.id, BACKFILL_MONTHS[1])
          ].join('\n')
        );
        return ctx.wizard.next();
      }

      const value = parseVideoCount(ctx);
      getState(ctx).values = {
        ...getState(ctx).values,
        [BACKFILL_MONTHS[0]]: value
      };

      await ctx.reply(
        [
          `Март сохраню как ${value}.`,
          'Теперь введи количество видео за апрель.',
          await getExistingText(ctx.state.currentUser!.id, BACKFILL_MONTHS[1])
        ].join('\n')
      );

      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Введи количество видео за март числом.'));
    }
  },
  async (ctx) => {
    try {
      const aprilValue = parseVideoCount(ctx);
      const values = {
        ...getState(ctx).values,
        [BACKFILL_MONTHS[1]]: aprilValue
      };

      if (typeof values[BACKFILL_MONTHS[0]] === 'number') {
        await container.services.monthlyVideoService.saveMonthlyCount(
          ctx.state.currentUser!.id,
          BACKFILL_MONTHS[0],
          values[BACKFILL_MONTHS[0]]!,
          { force: true }
        );
      }

      await container.services.monthlyVideoService.saveMonthlyCount(
        ctx.state.currentUser!.id,
        BACKFILL_MONTHS[1],
        aprilValue,
        { force: true }
      );

      await ctx.reply(
        [
          'Готово, количество видео сохранено:',
          typeof values[BACKFILL_MONTHS[0]] === 'number'
            ? `- 2026-03: ${values[BACKFILL_MONTHS[0]]}`
            : '- 2026-03: пропущено',
          `- 2026-04: ${aprilValue}`,
          'Эти значения будут использоваться в выплатах и документах.'
        ].join('\n'),
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await replyCreatorPostStatisticsNextStep(ctx);
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'March/April monthly video backfill failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(
        'Не удалось сохранить март и апрель. Проверь, что введено число, и попробуй временную кнопку еще раз.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
    }
  }
);
