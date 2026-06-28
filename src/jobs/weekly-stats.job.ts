import { NotificationType, SocialPlatform, UserRole, WeeklyReportStatus } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import { container } from '../container';
import { logger } from '../lib/logger';
import type { BotContext } from '../types/bot-context';
import { normalizeErrorForLog } from '../utils/error-logging';
import { formatCreatorDisplayName, formatIntegerRu } from '../utils/formatters';
import { formatPeriodLabel, getNow, getWeeklyReportPeriod, toDateOnly } from '../utils/periods';
import { formatPlatformStatMetrics } from '../utils/social-platform-metrics';
import { isTelegramDirectMessageUnavailableError } from '../utils/telegram-errors';

const SUBMITTED_WEEKLY_STATUSES = new Set<WeeklyReportStatus>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  [SocialPlatform.INSTAGRAM]: 'Instagram',
  [SocialPlatform.TIKTOK]: 'TikTok',
  [SocialPlatform.VK]: 'VK',
  [SocialPlatform.YOUTUBE]: 'YouTube'
};

const REMINDER_MESSAGES: Record<string, string> = {
  '12': 'Напоминание: сегодня нужно заполнить недельную статистику за прошлую неделю.',
  '15': 'Напоминаю: недельную статистику еще нужно заполнить.',
  '18': 'У тебя все еще не заполнена недельная статистика за прошлую неделю.',
  '20': 'Последнее напоминание: если не заполнить статистику до 21:00, результаты недели не будут учтены.'
};

const TELEGRAM_MESSAGE_LIMIT = 3900;

type WeeklyReportForTeamLead = Awaited<
  ReturnType<typeof container.repositories.weeklyStatsRepository.listReportsForCreatorsInPeriod>
>[number];

type ListedCreator = Awaited<ReturnType<typeof container.services.userService.listCreators>>[number];

const shouldReceiveWeeklyStatsReminders = (creator: ListedCreator) =>
  creator.role === UserRole.CREATOR || Boolean(creator.creatorProfile?.profileCompleted);

const getCurrentReminderSlot = () => getNow().format('HH');

const getReportVideoCount = (report: WeeklyReportForTeamLead) =>
  report.totalVideoCount ?? report.items.reduce((sum, item) => sum + item.videoCount, 0);

const getReportTotals = (report: WeeklyReportForTeamLead) => ({
  videoCount: getReportVideoCount(report),
  views: report.items.reduce((sum, item) => sum + item.views, 0),
  likes: report.items.reduce((sum, item) => sum + item.likes, 0),
  comments: report.items.reduce((sum, item) => sum + item.comments, 0),
  reposts: report.items.reduce((sum, item) => sum + item.reposts, 0),
  saves: report.items.reduce((sum, item) => sum + item.saves, 0)
});

const splitTelegramMessage = (text: string) => {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (`${current}\n${line}`.length > TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(current);
      current = line;
      continue;
    }

    current = current ? `${current}\n${line}` : line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const buildReminderMessage = (slot: string, periodLabel: string) =>
  [
    REMINDER_MESSAGES[slot],
    `Период: ${periodLabel}.`,
    'Открой раздел "Внести статистику за 7 дней" и отправь отчет.'
  ].join('\n');

const formatPlatformLine = (item: WeeklyReportForTeamLead['items'][number]) =>
  `  ${PLATFORM_LABELS[item.platform]}: ${formatPlatformStatMetrics(item)}`;

const formatSubmittedCreatorBlock = (
  creatorName: string,
  report: WeeklyReportForTeamLead
) => {
  const totals = getReportTotals(report);

  return [
    `• ${creatorName}: сдал статистику`,
    `  Видео за неделю: ${formatIntegerRu(totals.videoCount)}`,
    `  Охваты: ${formatIntegerRu(totals.views)}, лайки: ${formatIntegerRu(totals.likes)}, комментарии: ${formatIntegerRu(
      totals.comments
    )}`,
    `  Репосты: ${formatIntegerRu(totals.reposts)}, сохранения: ${formatIntegerRu(totals.saves)}`,
    report.attachments.length > 0
      ? `  Скрины: ${formatIntegerRu(report.attachments.length)}`
      : '  Скрины не приложены',
    report.items.length
      ? report.items.map(formatPlatformLine).join('\n')
      : '  Данных по платформам пока нет'
  ].join('\n');
};

const formatMissingCreatorBlock = (
  creatorName: string,
  report: WeeklyReportForTeamLead | undefined
) => {
  if (report?.status === WeeklyReportStatus.DRAFT && report.items.length > 0) {
    return `• ${creatorName}: начал заполнение, но не отправил отчет. Результаты недели не учтены.`;
  }

  return `• ${creatorName}: статистика не сдана. Результаты недели не учтены.`;
};

const buildTeamLeadReportMessage = (
  periodLabel: string,
  creators: Awaited<ReturnType<typeof container.services.teamLeadReportService.listGroupCreators>>,
  reportsByCreatorId: Map<string, WeeklyReportForTeamLead>
) => {
  if (creators.length === 0) {
    return [
      `Недельная статистика за ${periodLabel}`,
      '',
      'В твоей группе пока нет креаторов.'
    ].join('\n');
  }

  const submitted: string[] = [];
  const missing: string[] = [];

  for (const creator of creators) {
    const creatorName = formatCreatorDisplayName(creator, 'Креатор');
    const report = reportsByCreatorId.get(creator.id);

    if (report && SUBMITTED_WEEKLY_STATUSES.has(report.status)) {
      submitted.push(formatSubmittedCreatorBlock(creatorName, report));
      continue;
    }

    missing.push(formatMissingCreatorBlock(creatorName, report));
  }

  return [
    `Недельная статистика за ${periodLabel}`,
    '',
    `Сдали: ${formatIntegerRu(submitted.length)}`,
    submitted.length ? submitted.join('\n\n') : '• Пока никто не сдал статистику',
    '',
    `Не сдали: ${formatIntegerRu(missing.length)}`,
    missing.length ? missing.join('\n') : '• Нет'
  ].join('\n');
};

export const runWeeklyStatsReminderJob = async (
  bot: Telegraf<BotContext>,
  slot = getCurrentReminderSlot()
) => {
  const messageTemplate = REMINDER_MESSAGES[slot];

  if (!messageTemplate) {
    logger.warn({ slot }, 'Weekly stats reminder skipped: unsupported reminder slot');
    return;
  }

  const creators = (await container.services.userService.listCreators()).filter(shouldReceiveWeeklyStatsReminders);

  for (const creator of creators) {
    let reportPeriod: { weekStart?: string; weekEnd?: string } = {};

    try {
      const report = await container.services.weeklyStatsService.getOrCreateCurrentReport(creator.id);
      const weekStart = report.weekStart.toISOString().slice(0, 10);
      const weekEnd = report.weekEnd.toISOString().slice(0, 10);
      const periodLabel = formatPeriodLabel(weekStart, weekEnd);
      reportPeriod = { weekStart, weekEnd };

      if (SUBMITTED_WEEKLY_STATUSES.has(report.status)) {
        continue;
      }

      await bot.telegram.sendMessage(creator.telegramId, buildReminderMessage(slot, periodLabel));
      await container.repositories.notificationRepository.create(
        creator.id,
        NotificationType.WEEKLY_STATS_REMINDER,
        {
          creatorUserId: creator.id,
          weekStart,
          weekEnd,
          slot
        }
      );
    } catch (error) {
      if (isTelegramDirectMessageUnavailableError(error)) {
        logger.warn(
          {
            error: normalizeErrorForLog(error),
            creatorUserId: creator.id,
            telegramId: creator.telegramId,
            slot,
            ...reportPeriod
          },
          'Weekly stats reminder skipped: Telegram direct message unavailable'
        );
        continue;
      }

      logger.error(
        {
          error: normalizeErrorForLog(error),
          creatorUserId: creator.id,
          telegramId: creator.telegramId,
          slot
        },
        'Weekly stats reminder failed for creator'
      );
    }
  }
};

export const runWeeklyStatsTeamLeadReportJob = async (bot: Telegraf<BotContext>) => {
  const period = getWeeklyReportPeriod();
  const periodLabel = formatPeriodLabel(period.weekStart, period.weekEnd);
  const weekStart = toDateOnly(period.weekStart);
  const weekEnd = toDateOnly(period.weekEnd);
  const teamLeads = await container.services.userService.listTeamLeads();
  const assignedCreatorIds = new Set<string>();

  if (teamLeads.length === 0) {
    logger.info({ weekStart: period.weekStart, weekEnd: period.weekEnd }, 'Weekly stats teamlead report skipped: no teamleads');
    return;
  }

  for (const teamLead of teamLeads) {
    try {
      const creators = await container.services.teamLeadReportService.listGroupCreators(teamLead.id);
      creators.forEach((creator) => assignedCreatorIds.add(creator.id));

      const reports = creators.length
        ? await container.repositories.weeklyStatsRepository.listReportsForCreatorsInPeriod(
            creators.map((creator) => creator.id),
            weekStart,
            weekEnd
          )
        : [];
      const reportsByCreatorId = new Map(reports.map((report) => [report.creatorUserId, report]));
      const message = buildTeamLeadReportMessage(periodLabel, creators, reportsByCreatorId);

      for (const chunk of splitTelegramMessage(message)) {
        await bot.telegram.sendMessage(teamLead.telegramId, chunk);
      }

      await container.repositories.notificationRepository.create(teamLead.id, NotificationType.SYSTEM, {
        type: 'weekly_stats_teamlead_report',
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        creatorsTotal: creators.length,
        submittedTotal: reports.filter((report) => SUBMITTED_WEEKLY_STATUSES.has(report.status)).length
      });
    } catch (error) {
      if (isTelegramDirectMessageUnavailableError(error)) {
        logger.warn(
          {
            error: normalizeErrorForLog(error),
            teamLeadUserId: teamLead.id,
            telegramId: teamLead.telegramId,
            weekStart: period.weekStart,
            weekEnd: period.weekEnd
          },
          'Weekly stats teamlead report skipped: Telegram direct message unavailable'
        );
        continue;
      }

      logger.error(
        {
          error: normalizeErrorForLog(error),
          teamLeadUserId: teamLead.id,
          telegramId: teamLead.telegramId,
          weekStart: period.weekStart,
          weekEnd: period.weekEnd
        },
        'Weekly stats teamlead report failed'
      );
    }
  }

  const allCreators = (await container.services.userService.listCreators()).filter(shouldReceiveWeeklyStatsReminders);
  const unassignedCreators = allCreators.filter((creator) => !assignedCreatorIds.has(creator.id));

  if (unassignedCreators.length > 0) {
    logger.warn(
      {
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        creatorUserIds: unassignedCreators.map((creator) => creator.id)
      },
      'Weekly stats teamlead report skipped unassigned creators'
    );
  }
};

export const runWeeklyStatsJob = runWeeklyStatsReminderJob;
