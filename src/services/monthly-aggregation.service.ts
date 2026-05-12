import type { MonthlyAggregationSummary, PlatformStatSummary } from '../types/report.types';
import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { getMonthRange, toDateKey, toDateOnly } from '../utils/periods';
import { hasWeeklyReportData } from '../utils/weekly-report-data';

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

type AggregationReport = Awaited<ReturnType<WeeklyStatsRepository['listReportsByCreatorAndMonth']>>[number];
type AggregationItem = AggregationReport['items'][number];

const maxDate = (dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((latest, date) => (date && (!latest || date > latest) ? date : latest), null);

const getReportLatestDate = (report: AggregationReport) =>
  maxDate([report.updatedAt, ...report.items.map((item) => item.updatedAt)]);

const getItemLatestDate = (report: AggregationReport, item: AggregationItem) =>
  maxDate([report.updatedAt, item.updatedAt]);

const normalizeReportStart = (
  report: { weekStart: Date },
  monthRange: { dateFrom: string; dateTo: string }
) => {
  const monthStart = toDateOnly(monthRange.dateFrom);

  return report.weekStart < monthStart ? monthStart : report.weekStart;
};

const normalizeReportEnd = (
  report: { weekEnd: Date },
  monthRange: { dateFrom: string; dateTo: string }
) => {
  const monthEnd = toDateOnly(monthRange.dateTo);

  return report.weekEnd > monthEnd ? monthEnd : report.weekEnd;
};

const getNormalizedReportPeriodKey = (
  report: { weekStart: Date; weekEnd: Date },
  monthRange: { dateFrom: string; dateTo: string }
) => `${toDateKey(normalizeReportStart(report, monthRange))}:${toDateKey(normalizeReportEnd(report, monthRange))}`;

const selectLatestReportsByPeriod = (
  reports: AggregationReport[],
  monthRange: { dateFrom: string; dateTo: string }
) => {
  const latestByPeriod = new Map<string, AggregationReport>();

  for (const report of reports) {
    const periodKey = getNormalizedReportPeriodKey(report, monthRange);
    const current = latestByPeriod.get(periodKey);

    if (!current) {
      latestByPeriod.set(periodKey, report);
      continue;
    }

    const reportLatestDate = getReportLatestDate(report);
    const currentLatestDate = getReportLatestDate(current);

    if (reportLatestDate && (!currentLatestDate || reportLatestDate > currentLatestDate)) {
      latestByPeriod.set(periodKey, report);
    }
  }

  return Array.from(latestByPeriod.values()).sort(
    (left, right) => normalizeReportStart(left, monthRange).getTime() - normalizeReportStart(right, monthRange).getTime()
  );
};

const selectLatestItemsByPeriodAndPlatform = (
  reports: AggregationReport[],
  monthRange: { dateFrom: string; dateTo: string }
) => {
  const latestItems = new Map<string, { report: AggregationReport; item: AggregationItem; updatedAt: Date | null }>();

  for (const report of reports) {
    const periodKey = getNormalizedReportPeriodKey(report, monthRange);

    for (const item of report.items) {
      const itemKey = `${periodKey}:${item.platform}`;
      const updatedAt = getItemLatestDate(report, item);
      const current = latestItems.get(itemKey);

      if (!current || (updatedAt && (!current.updatedAt || updatedAt > current.updatedAt))) {
        latestItems.set(itemKey, { report, item, updatedAt });
      }
    }
  }

  return Array.from(latestItems.values()).sort((left, right) => {
    const periodCompare =
      normalizeReportStart(left.report, monthRange).getTime() - normalizeReportStart(right.report, monthRange).getTime();

    if (periodCompare !== 0) {
      return periodCompare;
    }

    return left.item.platform.localeCompare(right.item.platform);
  });
};

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
  toDateKey(normalizeReportStart(report, monthRange)) === monthRange.dateFrom &&
  toDateKey(normalizeReportEnd(report, monthRange)) === monthRange.dateTo &&
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
    const reportsWithData = reports.filter(hasWeeklyReportData);
    const fullMonthReports = reportsWithData.filter(
      (report) => toDateKey(report.weekStart) === monthRange.dateFrom && toDateKey(report.weekEnd) === monthRange.dateTo
    );
    const reportsForAggregationBase = fullMonthReports.length > 0 ? fullMonthReports : reportsWithData;
    const reportsForAggregation = selectLatestReportsByPeriod(reportsForAggregationBase, monthRange);
    const itemsForAggregation = selectLatestItemsByPeriodAndPlatform(reportsForAggregationBase, monthRange);
    const isTemporaryReachBackfill =
      reportsForAggregation.length > 0 &&
      reportsForAggregation.every((report) => isTemporaryReachBackfillReport(report, monthRange));

    const platformMap = new Map<string, PlatformStatSummary>();

    for (const { item } of itemsForAggregation) {
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
