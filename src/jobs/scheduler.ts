import cron, { type ScheduledTask } from 'node-cron';
import type { Telegraf } from 'telegraf';

import { config } from '../config';
import { runDailyMissedCheckJob } from './daily-missed-check.job';
import { runDailyReminderJob } from './daily-reminder.job';
import { runDocumentReceiptReminderJob } from './document-receipt-reminder.job';
import { runGoogleSheetsNightlyJob } from './google-sheets-nightly.job';
import { runWeeklyStatsReminderJob, runWeeklyStatsTeamLeadReportJob } from './weekly-stats.job';
import type { BotContext } from '../types/bot-context';

export const startScheduler = (bot: Telegraf<BotContext>) => {
  const googleSheetsNightlySyncCron = config.cron.googleSheetsNightlySync;

  const tasks: ScheduledTask[] = [
    cron.schedule(config.cron.dailyReminder, () => void runDailyReminderJob(bot), {
      timezone: config.app.tz
    }),
    cron.schedule(config.cron.dailyMissedCheck, () => void runDailyMissedCheckJob(bot), {
      timezone: config.app.tz
    }),
    cron.schedule(config.cron.weeklyStatsReminder, () => void runWeeklyStatsReminderJob(bot), {
      timezone: config.app.tz
    }),
    cron.schedule(config.cron.weeklyStatsTeamLeadReport, () => void runWeeklyStatsTeamLeadReportJob(bot), {
      timezone: config.app.tz
    }),
    cron.schedule(config.cron.documentReceiptReminder, () => void runDocumentReceiptReminderJob(bot), {
      timezone: config.app.tz
    }),
    ...(config.googleSheets.enabled && googleSheetsNightlySyncCron
      ? [
          cron.schedule(googleSheetsNightlySyncCron, () => void runGoogleSheetsNightlyJob(), {
            timezone: config.app.tz
          })
        ]
      : [])
  ];

  return {
    stop() {
      tasks.forEach((task) => task.stop());
    }
  };
};
