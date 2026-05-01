import { DailyPublicationStatus, NotificationType } from '@prisma/client';
import type { Telegram } from 'telegraf';

import { logger } from '../lib/logger';
import { DailyCheckRepository } from '../repositories/daily-check.repository';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { buildDailyCheckInlineKeyboard } from '../keyboards/inline.keyboards';
import { toDateOnly, toDateKey, getNow } from '../utils/periods';

export class DailyCheckService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly dailyCheckRepository: DailyCheckRepository,
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly notificationRepository: NotificationRepository
  ) {}

  async getTodayCheck(creatorUserId: string) {
    return this.dailyCheckRepository.findByCreatorAndDate(creatorUserId, toDateOnly(getNow()));
  }

  async promptCreatorToday(telegram: Telegram, creatorUserId: string, telegramId: string) {
    const check = await this.dailyCheckRepository.upsertPendingCheck(creatorUserId, toDateOnly(getNow()));
    await telegram.sendMessage(telegramId, 'Ты опубликовал видео за сегодня?', buildDailyCheckInlineKeyboard(check.id));
    await this.notificationRepository.create(creatorUserId, NotificationType.DAILY_PUBLICATION_REMINDER, {
      checkId: check.id,
      checkDate: toDateKey(getNow())
    });
    return check;
  }

  async sendDailyReminders(telegram: Telegram) {
    if (getNow().day() === 0) {
      return;
    }

    const creators = await this.userRepository.listActiveCreators();

    for (const creator of creators) {
      try {
        await this.promptCreatorToday(telegram, creator.id, creator.telegramId);
      } catch (error) {
        logger.error({ error, creatorUserId: creator.id }, 'Failed to send daily reminder');
      }
    }
  }

  async confirmCheck(creatorUserId: string, checkId: string) {
    const check = await this.dailyCheckRepository.findById(checkId);

    if (!check || check.creatorUserId !== creatorUserId) {
      throw new Error('Проверка не найдена');
    }

    if (check.status === DailyPublicationStatus.CONFIRMED) {
      return check;
    }

    return this.dailyCheckRepository.confirmById(checkId);
  }

  async processMissedChecks(telegram: Telegram) {
    if (getNow().day() === 0) {
      return;
    }

    const checks = await this.dailyCheckRepository.markMissedAndNeedNotification(toDateOnly(getNow()));
    const grouped = new Map<string, typeof checks>();

    for (const check of checks) {
      const link = check.creator.creatorAssignments[0];

      if (!link?.teamLead) {
        logger.warn({ creatorUserId: check.creatorUserId }, 'Creator has no active teamlead for missed reminder');
        continue;
      }

      const bucket = grouped.get(link.teamLead.id) ?? [];
      bucket.push(check);
      grouped.set(link.teamLead.id, bucket);
    }

    for (const checksForLead of grouped.values()) {
      const teamLead = checksForLead[0]?.creator.creatorAssignments[0]?.teamLead;

      if (!teamLead) {
        continue;
      }

      const text = [
        'Не подтверждена выкладка за сегодня:',
        ...checksForLead.map(
          (check) => `• ${check.creator.creatorProfile?.fullName ?? check.creator.firstName ?? check.creator.telegramId}`
        )
      ].join('\n');

      try {
        await telegram.sendMessage(teamLead.telegramId, text);
        await this.notificationRepository.create(teamLead.id, NotificationType.DAILY_MISSED_TEAMLEAD, {
          checkDate: toDateKey(getNow()),
          creators: checksForLead.map((item) => item.creatorUserId)
        });
        await this.dailyCheckRepository.markTeamLeadNotified(checksForLead.map((item) => item.id));
      } catch (error) {
        logger.error({ error, teamLeadUserId: teamLead.id }, 'Failed to send missed confirmation report to teamlead');
      }
    }

    await this.dailyCheckRepository.markMissed(checks.map((item) => item.id));
  }
}
