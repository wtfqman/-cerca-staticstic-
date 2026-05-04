import type { MonthlyAggregationSummary, PlatformStatSummary } from '../types/report.types';
import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { getMonthRange, toDateKey, toDateOnly } from '../utils/periods';

const EMPTY_TOTALS = {
  videoCount: 0,
  views: 0,
  likes: 0,
  comments: 0,
  reposts: 0,
  saves: 0
};

const getReportVideoCount = (report: {
  totalVideoCount?: number | null;
  items: Array<{ videoCount: number }>;
}) => report.totalVideoCount ?? report.items.reduce((sum, item) => sum + item.videoCount, 0);

const isTemporaryReachBackfillReport = (
  report: {
    weekStart: Date;
    weekEnd: Date;
    items: Array<{
      videoCount: number;
      views: number;
      likes: number;
      comments: number;
      reposts: number;
      saves: number;
    }>;
  },
  monthRange: { dateFrom: string; dateTo: string }
) =>
  toDateKey(report.weekStart) === monthRange.dateFrom &&
  toDateKey(report.weekEnd) === monthRange.dateTo &&
  report.items.some((item) => item.views > 0) &&
  report.items.every(
    (item) =>
      item.videoCount === 0 &&
      item.likes === 0 &&
      item.comments === 0 &&
      item.reposts === 0 &&
      item.saves === 0
  );

export class MonthlyAggregationService {
  constructor(
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly monthlyVideoRepository: MonthlyVideoRepository
  ) {}

  async aggregateCreatorMonth(
    creatorUserId: string,
    monthKey: string,
    options: { submittedOnly?: boolean } = {}
  ): Promise<MonthlyAggregationSummary> {
    const [reports, monthlyVideo] = await Promise.all([
      this.weeklyStatsRepository.listReportsByCreatorAndMonth(creatorUserId, monthKey, {
        submittedOnly: options.submittedOnly
      }),
      this.monthlyVideoRepository.findByCreatorAndMonth(creatorUserId, monthKey)
    ]);
    const monthRange = getMonthRange(monthKey);
    const fullMonthReports = reports.filter(
      (report) => toDateKey(report.weekStart) === monthRange.dateFrom && toDateKey(report.weekEnd) === monthRange.dateTo
    );
    const reportsForAggregation = fullMonthReports.length > 0 ? fullMonthReports : reports;
    const isTemporaryReachBackfill =
      reportsForAggregation.length > 0 &&
      reportsForAggregation.every((report) => isTemporaryReachBackfillReport(report, monthRange));

    const platformMap = new Map<string, PlatformStatSummary>();

    for (const report of reportsForAggregation) {
      for (const item of report.items) {
        const current = platformMap.get(item.platform) ?? {
          platform: item.platform,
          ...EMPTY_TOTALS
        };

        current.videoCount += item.videoCount;
        current.views += item.views;
        current.likes += item.likes;
        current.comments += item.comments;
        current.reposts += item.reposts;
        current.saves += item.saves;

        platformMap.set(item.platform, current);
      }
    }

    const platformBreakdown = Array.from(platformMap.values()).sort((a, b) => a.platform.localeCompare(b.platform));
    const totals = platformBreakdown.reduce(
      (accumulator, item) => ({
        videoCount: accumulator.videoCount + item.videoCount,
        views: accumulator.views + item.views,
        likes: accumulator.likes + item.likes,
        comments: accumulator.comments + item.comments,
        reposts: accumulator.reposts + item.reposts,
        saves: accumulator.saves + item.saves
      }),
      { ...EMPTY_TOTALS }
    );
    totals.videoCount = reportsForAggregation.reduce((sum, report) => sum + getReportVideoCount(report), 0);

    return {
      creatorUserId,
      monthKey,
      period: {
        monthKey,
        dateFrom: monthRange.dateFrom,
        dateTo: monthRange.dateTo
      },
      weeklyReportCount: reportsForAggregation.length,
      isTemporaryReachBackfill,
      totals,
      platformBreakdown,
      monthlyVideoCount: monthlyVideo?.videoCount ?? 0,
      monthlyVideoSubmitted: Boolean(monthlyVideo)
    };
  }

  async aggregateCreatorPeriod(creatorUserId: string, dateFrom: string, dateTo: string) {
    const reports = await this.weeklyStatsRepository.listReportsByCreatorInRange(
      creatorUserId,
      toDateOnly(dateFrom),
      toDateOnly(dateTo)
    );

    const platformMap = new Map<string, PlatformStatSummary>();

    for (const report of reports) {
      for (const item of report.items) {
        const current = platformMap.get(item.platform) ?? {
          platform: item.platform,
          ...EMPTY_TOTALS
        };

        current.videoCount += item.videoCount;
        current.views += item.views;
        current.likes += item.likes;
        current.comments += item.comments;
        current.reposts += item.reposts;
        current.saves += item.saves;

        platformMap.set(item.platform, current);
      }
    }

    const platformBreakdown = Array.from(platformMap.values()).sort((a, b) => a.platform.localeCompare(b.platform));
    const totals = platformBreakdown.reduce(
      (accumulator, item) => ({
        videoCount: accumulator.videoCount + item.videoCount,
        views: accumulator.views + item.views,
        likes: accumulator.likes + item.likes,
        comments: accumulator.comments + item.comments,
        reposts: accumulator.reposts + item.reposts,
        saves: accumulator.saves + item.saves
      }),
      { ...EMPTY_TOTALS }
    );
    totals.videoCount = reports.reduce((sum, report) => sum + getReportVideoCount(report), 0);

    return {
      creatorUserId,
      monthKey: '',
      period: {
        dateFrom,
        dateTo
      },
      weeklyReportCount: reports.length,
      totals,
      platformBreakdown,
      monthlyVideoCount: 0,
      monthlyVideoSubmitted: false
    };
  }
}
