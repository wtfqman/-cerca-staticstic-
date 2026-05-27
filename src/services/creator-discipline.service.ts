import { WeeklyReportStatus } from '@prisma/client';

import type {
  CreatorMonthlyVideoStatusSummary,
  CreatorWeeklyDisciplineSummary,
  WeeklyDisciplineStatus
} from '../types/report.types';
import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { formatAssignedTeamLeadName, formatCreatorDisplayName, formatIsoDateTime } from '../utils/formatters';
import { getNow, getWeeklyReportPeriod, getWeeklyReportPeriodsForMonth, toDateOnly } from '../utils/periods';

type CreatorReference = {
  id: string;
  isActive?: boolean | null;
  firstName?: string | null;
  lastName?: string | null;
  telegramId?: string | null;
  creatorProfile?: {
    fullName?: string | null;
  } | null;
  creatorAssignments?: Array<{
    teamLead: {
      firstName?: string | null;
      lastName?: string | null;
      telegramId?: string | null;
      teamLeadProfile?: {
        displayName?: string | null;
      } | null;
    };
  }>;
};

const isActiveCreator = (creator: CreatorReference) => creator.isActive !== false;

const SUBMITTED_STATUSES = new Set<WeeklyReportStatus>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);

export class CreatorDisciplineService {
  constructor(
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly monthlyVideoRepository: MonthlyVideoRepository
  ) {}

  async getWeeklySummariesForCreators(
    creators: CreatorReference[],
    options: {
      weekStart?: string;
      weekEnd?: string;
      monthKey?: string;
      historical?: boolean;
    } = {}
  ): Promise<CreatorWeeklyDisciplineSummary[]> {
    const activeCreators = creators.filter(isActiveCreator);
    const period =
      options.weekStart && options.weekEnd
        ? {
            weekStart: options.weekStart,
            weekEnd: options.weekEnd,
            monthKey: options.monthKey ?? options.weekEnd.slice(0, 7)
          }
        : getWeeklyReportPeriod(getNow());
    const reports = await this.weeklyStatsRepository.listReportsForCreatorsInPeriod(
      activeCreators.map((creator) => creator.id),
      toDateOnly(period.weekStart),
      toDateOnly(period.weekEnd)
    );
    const reportsMap = new Map(reports.map((report) => [report.creatorUserId, report]));

    return activeCreators.map((creator) => {
      const report = reportsMap.get(creator.id);
      const status = this.resolveWeeklyStatus(report, Boolean(options.historical));

      return {
        creatorUserId: creator.id,
        creatorName: formatCreatorDisplayName(creator),
        teamLeadName: formatAssignedTeamLeadName(creator),
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        monthKey: period.monthKey,
        status,
        itemCount: report?.items.length ?? 0,
        reportId: report?.id,
        submittedAt: formatIsoDateTime(report?.submittedAt),
        updatedAt: formatIsoDateTime(report?.updatedAt)
      };
    });
  }

  async getWeeklyAttentionForCreators(creators: CreatorReference[]) {
    const summaries = await this.getWeeklySummariesForCreators(creators);
    return summaries.filter((summary) => summary.status !== 'SUBMITTED');
  }

  async getMonthlyVideoStatuses(
    creators: CreatorReference[],
    monthKey: string
  ): Promise<CreatorMonthlyVideoStatusSummary[]> {
    const activeCreators = creators.filter(isActiveCreator);
    const records = await this.monthlyVideoRepository.listByCreatorsAndMonth(
      activeCreators.map((creator) => creator.id),
      monthKey
    );
    const recordsMap = new Map(records.map((record) => [record.creatorUserId, record]));

    return activeCreators.map((creator) => {
      const record = recordsMap.get(creator.id);

      return {
        creatorUserId: creator.id,
        creatorName: formatCreatorDisplayName(creator),
        teamLeadName: formatAssignedTeamLeadName(creator),
        monthKey,
        status: record ? 'SUBMITTED' : 'MISSING',
        videoCount: record?.videoCount,
        submittedAt: formatIsoDateTime(record?.submittedAt),
        updatedAt: formatIsoDateTime(record?.updatedAt)
      };
    });
  }

  async getMonthWeeklySubmissionStats(creators: CreatorReference[], monthKey: string) {
    const activeCreators = creators.filter(isActiveCreator);
    const periods = getWeeklyReportPeriodsForMonth(monthKey);
    const reports = await this.weeklyStatsRepository.listReportsForCreatorsByMonth(
      activeCreators.map((creator) => creator.id),
      monthKey
    );
    const submittedCount = reports.filter((report) => SUBMITTED_STATUSES.has(report.status)).length;

    return {
      periods,
      submitted: submittedCount,
      absent: Math.max(activeCreators.length * periods.length - submittedCount, 0)
    };
  }

  private resolveWeeklyStatus(
    report: Awaited<ReturnType<WeeklyStatsRepository['listReportsForCreatorsInPeriod']>>[number] | undefined,
    historical: boolean
  ): WeeklyDisciplineStatus {
    if (!report) {
      return historical ? 'NO_DATA' : 'NOT_STARTED';
    }

    if (SUBMITTED_STATUSES.has(report.status)) {
      return 'SUBMITTED';
    }

    if (report.items.length > 0 || report.totalVideoCount !== null) {
      return 'IN_PROGRESS';
    }

    return historical ? 'NO_DATA' : 'NOT_STARTED';
  }
}
