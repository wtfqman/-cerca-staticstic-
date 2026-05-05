import type { TeamLeadGroupReportSummary } from '../types/report.types';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentCalculationService } from './payment-calculation.service';
import { formatFullName, formatTeamLeadDisplayName } from '../utils/formatters';
import { hasWeeklyReportData } from '../utils/weekly-report-data';

const EMPTY_TOTALS = {
  videoCount: 0,
  views: 0,
  likes: 0,
  comments: 0,
  reposts: 0,
  saves: 0
};

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

const buildWeeklyReviewSummary = (
  report: Awaited<ReturnType<WeeklyStatsRepository['listReportsByCreatorAndMonth']>>[number]
) => {
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
    totals: buildWeeklyTotals(report, items),
    items
  };
};

export class TeamLeadReportService {
  constructor(
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentService: PaymentCalculationService
  ) {}

  async listGroupCreators(teamLeadUserId: string) {
    const links = await this.teamLeadRepository.listCreatorsForTeamLead(teamLeadUserId);
    return links.map((link) => link.creator);
  }

  async getCreatorReport(teamLeadUserId: string, creatorUserId: string, monthKey: string) {
    const creators = await this.listGroupCreators(teamLeadUserId);
    const creator = creators.find((item) => item.id === creatorUserId);

    if (!creator) {
      throw new Error('Креатор не найден в группе тимлида');
    }

    const [aggregation, payment, weeklyReports] = await Promise.all([
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey),
      this.weeklyStatsRepository.listReportsByCreatorAndMonth(creatorUserId, monthKey)
    ]);

    return {
      creator,
      aggregation,
      payment,
      weeklyReports: weeklyReports.filter(hasWeeklyReportData).map(buildWeeklyReviewSummary)
    };
  }

  async getGroupReport(teamLeadUserId: string, monthKey: string): Promise<TeamLeadGroupReportSummary> {
    const creators = await this.listGroupCreators(teamLeadUserId);
    const creatorReports = await Promise.all(
      creators.map(async (creator) => {
        const [aggregation, payment, weeklyReports] = await Promise.all([
          this.aggregationService.aggregateCreatorMonth(creator.id, monthKey),
          this.paymentService.calculateForCreatorMonth(creator.id, monthKey),
          this.weeklyStatsRepository.listReportsByCreatorAndMonth(creator.id, monthKey)
        ]);

        return {
          entry: {
            creatorUserId: creator.id,
            creatorName:
              creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, 'Креатор'),
            monthKey,
            totals: aggregation.totals,
            totalPayment: payment.totalPayment,
            weeklyReportCount: aggregation.weeklyReportCount,
            monthlyVideoCount: aggregation.monthlyVideoCount,
            monthlyVideoSubmitted: aggregation.monthlyVideoSubmitted,
            payment
          },
          weeklyReports: weeklyReports.filter(hasWeeklyReportData).map(buildWeeklyReviewSummary)
        };
      })
    );

    const creatorEntries = creatorReports.map((item) => item.entry);
    const weeklyReports = creatorReports.flatMap((item) => item.weeklyReports);

    const totals = creatorEntries.reduce(
      (accumulator, item) => ({
        videoCount: accumulator.videoCount + item.totals.videoCount,
        views: accumulator.views + item.totals.views,
        likes: accumulator.likes + item.totals.likes,
        comments: accumulator.comments + item.totals.comments,
        reposts: accumulator.reposts + item.totals.reposts,
        saves: accumulator.saves + item.totals.saves
      }),
      { ...EMPTY_TOTALS }
    );

    return {
      teamLeadUserId,
      monthKey,
      totals,
      totalPayment: creatorEntries.reduce((sum, item) => sum + item.totalPayment, 0),
      creators: creatorEntries,
      weeklyReports
    };
  }
}
