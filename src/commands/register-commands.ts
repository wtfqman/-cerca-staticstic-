import type { Telegraf } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { handleHelp, handleMenu, handleProfile, handleStart } from '../handlers/common.handlers';

export const registerCommands = (bot: Telegraf<BotContext>) => {
  bot.start(handleStart);
  bot.command('menu', handleMenu);
  bot.command('profile', handleProfile);
  bot.command('help', handleHelp);
};
