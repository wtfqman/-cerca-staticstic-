import type { Telegraf } from 'telegraf';

import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';

export const TELEGRAM_BOT_COMMANDS = [
  { command: 'start', description: 'Запустить бота' },
  { command: 'menu', description: 'Показать главное меню' },
  { command: 'profile', description: 'Мой профиль' },
  { command: 'help', description: 'Помощь' },
  { command: 'cancel', description: 'Отменить текущий сценарий' }
];

export const syncTelegramCommands = async (bot: Telegraf<BotContext>) => {
  const scopes = [{ type: 'default' as const }, { type: 'all_private_chats' as const }];

  for (const scope of scopes) {
    await bot.telegram.setMyCommands(TELEGRAM_BOT_COMMANDS, { scope });
  }

  logger.info({ commands: TELEGRAM_BOT_COMMANDS.map((command) => command.command) }, 'Telegram bot commands synced');
};
