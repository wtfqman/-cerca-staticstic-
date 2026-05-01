import { Prisma, WeeklyReportStatus } from '@prisma/client';

import { prisma } from '../lib/prisma';

const submittedWeeklyStatuses = [WeeklyReportStatus.SUBMITTED, WeeklyReportStatus.CONFIRMED] as const;

const creatorRelationInclude = Prisma.validator<Prisma.UserInclude>()({
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
});

const teamLeadReviewerInclude = Prisma.validator<Prisma.UserInclude>()({
  teamLeadProfile: true
});

const reportWithItemsInclude = Prisma.validator<Prisma.WeeklyStatReportInclude>()({
  items: true,
  attachments: {
    orderBy: { sortOrder: 'asc' }
  },
  reviewedByTeamLead: {
    include: teamLeadReviewerInclude
  }
});

const reportWithRelationsInclude = Prisma.validator<Prisma.WeeklyStatReportInclude>()({
  items: true,
  attachments: {
    orderBy: { sortOrder: 'asc' }
  },
  reviewedByTeamLead: {
    include: teamLeadReviewerInclude
  },
  creator: {
    include: creatorRelationInclude
  }
});

const itemWithRelationsInclude = Prisma.validator<Prisma.WeeklyStatItemInclude>()({
  report: {
    include: {
      reviewedByTeamLead: {
        include: teamLeadReviewerInclude
      },
      attachments: {
        orderBy: { sortOrder: 'asc' }
      },
      creator: {
        include: creatorRelationInclude
      }
    }
  }
});

export class WeeklyStatsRepository {
  async findOrCreateReport(creatorUserId: string, monthKey: string, weekStart: Date, weekEnd: Date) {
    return prisma.weeklyStatReport.upsert({
      where: {
        creatorUserId_weekStart_weekEnd: {
          creatorUserId,
          weekStart,
          weekEnd
        }
      },
      create: {
        creatorUserId,
        monthKey,
        weekStart,
        weekEnd,
        status: WeeklyReportStatus.DRAFT
      },
      update: {
        monthKey
      },
      include: reportWithItemsInclude
    });
  }

  async getReportById(reportId: string) {
    return prisma.weeklyStatReport.findUnique({
      where: { id: reportId },
      include: reportWithItemsInclude
    });
  }

  async getReportByIdWithRelations(reportId: string) {
    return prisma.weeklyStatReport.findUnique({
      where: { id: reportId },
      include: reportWithRelationsInclude
    });
  }

  async getReportForPeriod(creatorUserId: string, weekStart: Date, weekEnd: Date) {
    return prisma.weeklyStatReport.findUnique({
      where: {
        creatorUserId_weekStart_weekEnd: {
          creatorUserId,
          weekStart,
          weekEnd
        }
      },
      include: reportWithItemsInclude
    });
  }

  async upsertItem(
    reportId: string,
    input: {
      platform: 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'YOUTUBE';
      videoCount: number;
      views: number;
      likes: number;
      comments: number;
      reposts: number;
      saves: number;
    }
  ) {
    return prisma.weeklyStatItem.upsert({
      where: {
        weeklyReportId_platform: {
          weeklyReportId: reportId,
          platform: input.platform
        }
      },
      create: {
        weeklyReportId: reportId,
        ...input
      },
      update: {
        ...input
      }
    });
  }

  async updateReportTotalVideoCount(reportId: string, totalVideoCount: number) {
    return prisma.weeklyStatReport.update({
      where: { id: reportId },
      data: {
        totalVideoCount
      },
      include: reportWithItemsInclude
    });
  }

  async countAttachments(reportId: string) {
    return prisma.weeklyStatAttachment.count({
      where: {
        weeklyReportId: reportId
      }
    });
  }

  async createAttachment(input: {
    weeklyReportId: string;
    creatorUserId: string;
    telegramFileId: string;
    telegramFileUniqueId?: string;
    filePath?: string;
    sortOrder: number;
  }) {
    return prisma.weeklyStatAttachment.create({
      data: {
        weeklyReportId: input.weeklyReportId,
        creatorUserId: input.creatorUserId,
        telegramFileId: input.telegramFileId,
        telegramFileUniqueId: input.telegramFileUniqueId,
        filePath: input.filePath,
        sortOrder: input.sortOrder
      }
    });
  }

  async listAttachmentsByReport(reportId: string) {
    return prisma.weeklyStatAttachment.findMany({
      where: {
        weeklyReportId: reportId
      },
      orderBy: {
        sortOrder: 'asc'
      }
    });
  }

  async submitReport(reportId: string) {
    return prisma.weeklyStatReport.update({
      where: { id: reportId },
      data: {
        status: WeeklyReportStatus.SUBMITTED,
        submittedAt: new Date()
      },
      include: reportWithItemsInclude
    });
  }

  async markReportReviewedByTeamLead(reportId: string, teamLeadUserId: string, reviewedAt = new Date()) {
    return prisma.weeklyStatReport.update({
      where: { id: reportId },
      data: {
        reviewedByTeamLeadId: teamLeadUserId,
        reviewedAt
      },
      include: reportWithRelationsInclude
    });
  }

  async listReportsByCreatorAndMonth(
    creatorUserId: string,
    monthKey: string,
    options: { submittedOnly?: boolean } = {}
  ) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId,
        monthKey,
        ...(options.submittedOnly
          ? {
              status: {
                in: [...submittedWeeklyStatuses]
              }
            }
          : {})
      },
      include: reportWithItemsInclude,
      orderBy: {
        weekStart: 'asc'
      }
    });
  }

  async listRecentReportsByCreator(creatorUserId: string, take = 6) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId
      },
      include: reportWithItemsInclude,
      orderBy: {
        weekStart: 'desc'
      },
      take
    });
  }

  async listReportsByCreatorInRange(creatorUserId: string, dateFrom: Date, dateTo: Date) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId,
        weekEnd: {
          gte: dateFrom,
          lte: dateTo
        }
      },
      include: reportWithItemsInclude,
      orderBy: {
        weekStart: 'asc'
      }
    });
  }

  async listAllReportsByCreator(creatorUserId: string) {
    return prisma.weeklyStatReport.findMany({
      where: { creatorUserId },
      include: reportWithItemsInclude,
      orderBy: {
        weekStart: 'asc'
      }
    });
  }

  async listSubmittedReportsForCreators(creatorIds: string[], monthKey: string) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        monthKey,
        status: {
          in: [...submittedWeeklyStatuses]
        }
      },
      include: reportWithRelationsInclude
    });
  }

  async listReportsForCreatorsInPeriod(creatorIds: string[], weekStart: Date, weekEnd: Date) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        weekStart,
        weekEnd
      },
      include: reportWithRelationsInclude
    });
  }

  async listReportsByMonth(monthKey: string) {
    return prisma.weeklyStatReport.findMany({
      where: { monthKey },
      include: reportWithRelationsInclude,
      orderBy: [{ weekStart: 'asc' }, { creatorUserId: 'asc' }]
    });
  }

  async listReportsForCreatorsByMonth(creatorIds: string[], monthKey: string) {
    return prisma.weeklyStatReport.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        monthKey
      },
      include: reportWithRelationsInclude,
      orderBy: [{ weekStart: 'asc' }, { creatorUserId: 'asc' }]
    });
  }

  async listItemsForSheetSync(filters: {
    reportId?: string;
    creatorUserId?: string;
    creatorIds?: string[];
    monthKey?: string;
  } = {}) {
    return prisma.weeklyStatItem.findMany({
      where: {
        weeklyReportId: filters.reportId,
        report: {
          creatorUserId: filters.creatorUserId,
          monthKey: filters.monthKey,
          ...(filters.creatorIds?.length ? { creatorUserId: { in: filters.creatorIds } } : {})
        }
      },
      include: itemWithRelationsInclude,
      orderBy: [
        { report: { weekStart: 'asc' } },
        { report: { creatorUserId: 'asc' } },
        { platform: 'asc' }
      ]
    });
  }

  async listCreatorMonthsWithData() {
    const reports = await prisma.weeklyStatReport.findMany({
      select: {
        creatorUserId: true,
        monthKey: true
      },
      distinct: ['creatorUserId', 'monthKey'],
      orderBy: [{ monthKey: 'asc' }, { creatorUserId: 'asc' }]
    });

    return reports;
  }

  async countSubmittedReportsForMonth(monthKey: string) {
    return prisma.weeklyStatReport.count({
      where: {
        monthKey,
        status: {
          in: [WeeklyReportStatus.SUBMITTED, WeeklyReportStatus.CONFIRMED]
        }
      }
    });
  }
}
