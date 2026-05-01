import { Scenes } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { replyCreatorPostStatisticsNextStep } from '../creators/creator-statistics-next-step';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import { confirmInlineKeyboard, monthlyVideoMonthKeyboard } from '../keyboards/inline.keyboards';
import { SCENE_IDS } from './scene-ids';
import { nonNegativeIntSchema } from '../validators/stats.schemas';
import { getMessageText } from '../utils/telegram';
import { formatValidationError, logUserError } from '../utils/user-errors';

type MonthlyVideoState = {
  monthKey?: string;
  videoCount?: number;
};

const getState = (ctx: BotContext) => ctx.wizard.state as MonthlyVideoState;

const hasCompleteMonthlyVideoState = (state: MonthlyVideoState) =>
  Boolean(state.monthKey) && typeof state.videoCount === 'number';

export const monthlyVideoScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.monthlyVideo,
  async (ctx) => {
    const [currentMonthKey, previousMonthKey] = container.services.monthlyVideoService.getSuggestedMonthOptions();
    await ctx.reply(
      'За какой месяц сохранить количество видео?',
      monthlyVideoMonthKeyboard(currentMonthKey, previousMonthKey)
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data.startsWith('monthly_video_month:')) {
      const monthKey = ctx.callbackQuery.data.split(':')[1];
      getState(ctx).monthKey = monthKey;
      const existing = await container.services.monthlyVideoService.getMonthCount(ctx.state.currentUser!.id, monthKey);
      await ctx.answerCbQuery();
      await ctx.reply(
        existing
          ? `Сейчас за ${monthKey} сохранено: ${existing.videoCount}. Введи новое количество видео, если нужно обновить значение.`
          : `За ${monthKey} количество видео еще не указано. Введи число, которое нужно сохранить.`
      );
      return ctx.wizard.next();
    }

    await ctx.reply('Выбери месяц кнопкой.');
  },
  async (ctx) => {
    try {
      getState(ctx).videoCount = nonNegativeIntSchema.parse(getMessageText(ctx.message));
      await ctx.reply(
        `Сохраняем ${getState(ctx).videoCount} видео за ${getState(ctx).monthKey}?`,
        confirmInlineKeyboard('monthly_video_confirm', 'monthly_video_edit')
      );
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Введите число.'));
    }
  },
  async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      await ctx.reply('Подтверди сохранение кнопкой ниже или нажми /cancel, чтобы выйти без изменений.');
      return;
    }

    if (ctx.callbackQuery.data === 'monthly_video_edit') {
      await ctx.answerCbQuery();
      await ctx.reply('Хорошо, введи количество заново.');
      return ctx.wizard.selectStep(2);
    }

    if (ctx.callbackQuery.data === 'monthly_video_confirm') {
      const state = getState(ctx);
      await ctx.answerCbQuery('Сохраняю количество видео...');

      if (!hasCompleteMonthlyVideoState(state)) {
        await ctx.reply(
          [
            'Не вижу выбранный месяц или количество видео.',
            'Сценарий ввода количества видео сброшен. Открой его заново из главного меню.'
          ].join('\n'),
          mainMenuKeyboardForUser(ctx.state.currentUser)
        );
        await ctx.scene.leave();
        return;
      }

      try {
        await container.services.monthlyVideoService.saveMonthlyCount(
          ctx.state.currentUser!.id,
          state.monthKey!,
          state.videoCount!
        );
        await ctx.reply(
          `Количество видео за ${state.monthKey} сохранено: ${state.videoCount}. Эти данные будут использоваться в расчетах выплат и документах.`,
          mainMenuKeyboardForUser(ctx.state.currentUser)
        );
        await replyCreatorPostStatisticsNextStep(ctx);
        await ctx.scene.leave();
      } catch (error) {
        logUserError(error, 'Monthly video save failed', {
          userId: ctx.state.currentUser?.id,
          monthKey: state.monthKey
        });
        const [currentMonthKey, previousMonthKey] = container.services.monthlyVideoService.getSuggestedMonthOptions();
        getState(ctx).monthKey = undefined;
        getState(ctx).videoCount = undefined;
        await ctx.reply(
          [
            'Не удалось сохранить количество видео.',
            'Выбери доступный месяц и попробуй еще раз.'
          ]
            .filter(Boolean)
            .join('\n'),
          monthlyVideoMonthKeyboard(currentMonthKey, previousMonthKey)
        );
        return ctx.wizard.selectStep(1);
      }
    }
  }
);
