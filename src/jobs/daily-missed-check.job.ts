import type { Telegraf } from 'telegraf';

import { container } from '../container';
import type { BotContext } from '../types/bot-context';

export const runDailyMissedCheckJob = async (bot: Telegraf<BotContext>) => {
  await container.services.dailyCheckService.processMissedChecks(bot.telegram);
};
