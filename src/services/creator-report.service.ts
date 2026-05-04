import type { CreatorReportSummary } from '../types/report.types';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentCalculationService } from './payment-calculation.service';
import { getCurrentMonthKey, getLastSevenDaysRange, getMonthRange, getPreviousMonthKey, toDateKey } from '../utils/periods';
import { formatTeamLeadDisplayName } from '../utils/formatters';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';

const buildWeeklyItems = (
  report: Awaited<ReturnType<WeeklyStatsRepository['listReportsByCreatorAndMonth']>>[number]
) =>
  report.items.map((item) => ({
    platform: item.platform,
    videoCount: item.videoCount,
    views: item.views,
    likes: item.likes,
    comments: item.comments,
    reposts: item.reposts,
    saves: item.saves
  }));

const buildWeeklyTotals = (
  report: Awaited<ReturnType<WeeklyStatsRepository['listReportsByCreatorAndMonth']>>[number],
  items: ReturnType<typeof buildWeeklyItems>
) => ({
  videoCount: report.totalVideoCount ?? items.reduce((sum, item) => sum + item.videoCount, 0),
  views: items.reduce((sum, item) => sum + item.views, 0),
  likes: items.reduce((sum, item) => sum + item.likes, 0),
  comments: items.reduce((sum, item) => sum + item.comments, 0),
  reposts: items.reduce((sum, item) => sum + item.reposts, 0),
  saves: items.reduce((sum, item) => sum + item.saves, 0)
});

const isTemporaryReachBackfillReport = (
  report: Awaited<ReturnType<WeeklyStatsRepository['listReportsByCreatorAndMonth']>>[number]
) => {
  const monthRange = getMonthRange(report.monthKey);

  return (
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
    )
  );
};

export class CreatorReportService {
  constructor(
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentService: PaymentCalculationService,
    private readonly weeklyStatsRepository: WeeklyStatsRepository
  ) {}

  async getMonthlyReport(creatorUserId: string, monthKey: string): Promise<CreatorReportSummary> {
    const [aggregation, payment, weeklyReports] = await Promise.all([
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey),
      this.weeklyStatsRepository.listReportsByCreatorAndMonth(creatorUserId, monthKey)
    ]);

    return {
      creatorUserId,
      monthKey,
      label: monthKey,
      aggregation,
      payment,
      weeklyReports: weeklyReports.map((report) => {
        const items = buildWeeklyItems(report);

        return {
          reportId: report.id,
          creatorUserId: report.creatorUserId,
          monthKey: report.monthKey,
          weekStart: report.weekStart.toISOString().slice(0, 10),
          weekEnd: report.weekEnd.toISOString().slice(0, 10),
          status: report.status,
          isReviewedByTeamLead: Boolean(report.reviewedAt),
          reviewedByTeamLeadId: report.reviewedByTeamLeadId ?? undefined,
          reviewedByTeamLeadName: report.reviewedByTeamLead
            ? formatTeamLeadDisplayName(report.reviewedByTeamLead)
            : undefined,
          reviewedAt: report.reviewedAt?.toISOString(),
          attachmentCount: report.attachments.length,
          totalVideoCount: report.totalVideoCount ?? items.reduce((sum, item) => sum + item.videoCount, 0),
          isTemporaryReachBackfill: isTemporaryReachBackfillReport(report),
          totals: buildWeeklyTotals(report, items),
          items
        };
      })
    };
  }

  getCurrentMonthReport(creatorUserId: string) {
    return this.getMonthlyReport(creatorUserId, getCurrentMonthKey());
  }

  getPreviousMonthReport(creatorUserId: string) {
    return this.getMonthlyReport(creatorUserId, getPreviousMonthKey());
  }

  async getLastSevenDaysSummary(creatorUserId: string) {
    const period = getLastSevenDaysRange();
    return this.aggregationService.aggregateCreatorPeriod(creatorUserId, period.dateFrom, period.dateTo);
  }

  async getLifetimeSummary(creatorUserId: string) {
    const reports = await this.weeklyStatsRepository.listAllReportsByCreator(creatorUserId);

    if (reports.length === 0) {
      return this.aggregationService.aggregateCreatorPeriod(creatorUserId, '2000-01-01', '2000-01-01');
    }

    const first = reports[0];
    const last = reports[reports.length - 1];

    return this.aggregationService.aggregateCreatorPeriod(
      creatorUserId,
      first.weekStart.toISOString().slice(0, 10),
      last.weekEnd.toISOString().slice(0, 10)
    );
  }
}
