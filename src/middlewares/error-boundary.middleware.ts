import type { MiddlewareFn } from 'telegraf';

import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';
import { normalizeErrorForLog } from '../utils/error-logging';

export const errorBoundaryMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    logger.error(
      {
        error: normalizeErrorForLog(error),
        requestId: ctx.state.requestId,
        updateId: ctx.update.update_id
      },
      'Telegram middleware error'
    );

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Не удалось выполнить действие').catch(() => undefined);
    }

    await ctx
      .reply('Что-то пошло не так. Я уже записал ошибку в лог. Попробуй еще раз или вернись в меню командой /menu.')
      .catch((replyError) => {
        logger.warn(
          {
            error: normalizeErrorForLog(replyError),
            requestId: ctx.state.requestId,
            updateId: ctx.update.update_id
          },
          'Failed to send Telegram error reply'
        );
      });
  }
};
