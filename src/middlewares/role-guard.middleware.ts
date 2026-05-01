import type { MiddlewareFn } from 'telegraf';
import { UserRole } from '@prisma/client';

import type { BotContext } from '../types/bot-context';
import { canUseScenario } from '../utils/access';

export const roleGuard = (...roles: UserRole[]): MiddlewareFn<BotContext> => {
  return async (ctx, next) => {
    const currentUser = ctx.state.currentUser;

    if (!currentUser || !roles.some((role) => canUseScenario(currentUser, role))) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Недоступно');
      }

      await ctx.reply(
        'Этот раздел сейчас для тебя недоступен. Если роль уже должна быть выдана, напиши администратору.'
      );
      return;
    }

    return next();
  };
};
