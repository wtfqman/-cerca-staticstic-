import { randomUUID } from 'node:crypto';

import type { MiddlewareFn } from 'telegraf';

import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';

export const updateLoggingMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  const requestId = randomUUID();
  ctx.state.requestId = requestId;

  logger.debug(
    {
      requestId,
      updateId: ctx.update.update_id,
      fromId: ctx.from?.id,
      chatId: ctx.chat?.id,
      updateType: ctx.updateType
    },
    'Incoming Telegram update'
  );

  return next();
};
