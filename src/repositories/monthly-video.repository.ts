import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

const monthlyVideoWithCreatorInclude = Prisma.validator<Prisma.MonthlyVideoCountInclude>()({
  creator: {
    include: {
      creatorProfile: true,
      creatorAssignments: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
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
});

export class MonthlyVideoRepository {
  async upsert(creatorUserId: string, monthKey: string, videoCount: number) {
    return prisma.monthlyVideoCount.upsert({
      where: {
        creatorUserId_monthKey: {
          creatorUserId,
          monthKey
        }
      },
      create: {
        creatorUserId,
        monthKey,
        videoCount,
        submittedAt: new Date()
      },
      update: {
        videoCount,
        submittedAt: new Date()
      }
    });
  }

  async findByCreatorAndMonth(creatorUserId: string, monthKey: string) {
    return prisma.monthlyVideoCount.findUnique({
      where: {
        creatorUserId_monthKey: {
          creatorUserId,
          monthKey
        }
      }
    });
  }

  async listRecentByCreator(creatorUserId: string, take = 6) {
    return prisma.monthlyVideoCount.findMany({
      where: { creatorUserId },
      orderBy: { monthKey: 'desc' },
      take
    });
  }

  async listByCreatorsAndMonth(creatorIds: string[], monthKey: string) {
    return prisma.monthlyVideoCount.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        monthKey
      },
      include: monthlyVideoWithCreatorInclude,
      orderBy: { creatorUserId: 'asc' }
    });
  }

  async listByMonth(monthKey: string) {
    return prisma.monthlyVideoCount.findMany({
      where: { monthKey },
      include: monthlyVideoWithCreatorInclude,
      orderBy: { creatorUserId: 'asc' }
    });
  }

  async listCreatorMonthsWithData() {
    return prisma.monthlyVideoCount.findMany({
      select: {
        creatorUserId: true,
        monthKey: true
      },
      distinct: ['creatorUserId', 'monthKey'],
      orderBy: [{ monthKey: 'asc' }, { creatorUserId: 'asc' }]
    });
  }
}
