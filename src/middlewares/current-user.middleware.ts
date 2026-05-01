import type { MiddlewareFn } from 'telegraf';

import { container } from '../container';
import type { BotContext } from '../types/bot-context';

export const currentUserMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) {
    return next();
  }

  ctx.state.currentUser = await container.services.authService.ensureTelegramUser(ctx.from);
  return next();
};
