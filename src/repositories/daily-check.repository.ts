import { DailyPublicationStatus } from '@prisma/client';

import { prisma } from '../lib/prisma';

export class DailyCheckRepository {
  async findById(id: string) {
    return prisma.dailyPublicationCheck.findUnique({
      where: { id }
    });
  }

  async upsertPendingCheck(creatorUserId: string, checkDate: Date) {
    return prisma.dailyPublicationCheck.upsert({
      where: {
        creatorUserId_checkDate: {
          creatorUserId,
          checkDate
        }
      },
      create: {
        creatorUserId,
        checkDate,
        status: DailyPublicationStatus.PENDING,
        reminderSentAt: new Date()
      },
      update: {
        reminderSentAt: new Date(),
        status: DailyPublicationStatus.PENDING
      }
    });
  }

  async findByCreatorAndDate(creatorUserId: string, checkDate: Date) {
    return prisma.dailyPublicationCheck.findUnique({
      where: {
        creatorUserId_checkDate: {
          creatorUserId,
          checkDate
        }
      }
    });
  }

  async confirmById(id: string) {
    return prisma.dailyPublicationCheck.update({
      where: { id },
      data: {
        status: DailyPublicationStatus.CONFIRMED,
        confirmedAt: new Date()
      }
    });
  }

  async markMissedAndNeedNotification(checkDate: Date) {
    return prisma.dailyPublicationCheck.findMany({
      where: {
        checkDate,
        status: DailyPublicationStatus.PENDING,
        teamLeadNotifiedAt: null
      },
      include: {
        creator: {
          include: {
            creatorProfile: true,
            creatorAssignments: {
              where: { isActive: true },
              include: {
                teamLead: {
                  include: {
                    teamLeadProfile: true
                  }
                }
              }
            }
          }
        }
      }
    });
  }

  async markMissed(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    await prisma.dailyPublicationCheck.updateMany({
      where: { id: { in: ids } },
      data: {
        status: DailyPublicationStatus.MISSED
      }
    });
  }

  async markTeamLeadNotified(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    await prisma.dailyPublicationCheck.updateMany({
      where: { id: { in: ids } },
      data: {
        teamLeadNotifiedAt: new Date()
      }
    });
  }

  async listPendingForCreators(creatorIds: string[], checkDate: Date) {
    return prisma.dailyPublicationCheck.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        checkDate,
        status: {
          in: [DailyPublicationStatus.PENDING, DailyPublicationStatus.MISSED]
        }
      },
      include: {
        creator: {
          include: {
            creatorProfile: true
          }
        }
      }
    });
  }
}
