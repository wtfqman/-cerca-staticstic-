import type { Telegraf } from 'telegraf';

import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';

export const syncTelegramCommands = async (bot: Telegraf<BotContext>) => {
  const scopes = [{ type: 'default' as const }, { type: 'all_private_chats' as const }];

  for (const scope of scopes) {
    await bot.telegram.deleteMyCommands({ scope });
  }

  logger.info({ scopes: scopes.map((scope) => scope.type) }, 'Telegram bot commands cleared');
};
