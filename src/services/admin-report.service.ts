import type { AdminReportSummary } from '../types/report.types';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { UserRepository } from '../repositories/user.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentCalculationService } from './payment-calculation.service';
import {
  CREATOR_INVOICE_MESSAGE_SURCHARGE,
  getCreatorInvoiceDisplayAmount
} from '../payments/payment.constants';
import { formatFullName } from '../utils/formatters';

const EMPTY_TOTALS = {
  videoCount: 0,
  views: 0,
  likes: 0,
  comments: 0,
  reposts: 0,
  saves: 0
};

export class AdminReportService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentService: PaymentCalculationService,
    private readonly weeklyStatsRepository?: WeeklyStatsRepository
  ) {}

  async getCreatorReport(creatorUserId: string, monthKey: string) {
    const [creator, aggregation, payment] = await Promise.all([
      this.userRepository.findById(creatorUserId),
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey)
    ]);

    if (!creator) {
      throw new Error('Креатор не найден');
    }

    return {
      creator,
      aggregation,
      payment
    };
  }

  async getTeamLeadReport(teamLeadUserId: string, monthKey: string) {
    const links = await this.teamLeadRepository.listCreatorsForTeamLead(teamLeadUserId);
    const creators = links.map((link) => link.creator);

    const items = await Promise.all(
      creators.map(async (creator) => {
        const [aggregation, payment] = await Promise.all([
          this.aggregationService.aggregateCreatorMonth(creator.id, monthKey),
          this.paymentService.calculateForCreatorMonth(creator.id, monthKey)
        ]);

        return {
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
        };
      })
    );

    return {
      teamLeadUserId,
      monthKey,
      creators: items,
      totalPayment: items.reduce((sum, item) => sum + item.totalPayment, 0)
    };
  }

  async getGlobalMonthReport(monthKey: string): Promise<AdminReportSummary> {
    const creators = await this.userRepository.listActiveCreators();

    const creatorSummaries = await Promise.all(
      creators.map(async (creator) => {
        const [aggregation, payment] = await Promise.all([
          this.aggregationService.aggregateCreatorMonth(creator.id, monthKey),
          this.paymentService.calculateForCreatorMonth(creator.id, monthKey)
        ]);

        return {
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
        };
      })
    );

    const totals = creatorSummaries.reduce(
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

    const groups = await this.teamLeadRepository.listGroups();
    const teamLeadMap = new Map<string, { teamLeadUserId: string; teamLeadName: string; creatorCount: number; totalPayment: number }>();

    for (const link of groups) {
      const teamLeadUserId = link.teamLead.id;
      const existing =
        teamLeadMap.get(teamLeadUserId) ??
        {
          teamLeadUserId,
          teamLeadName:
            link.teamLead.teamLeadProfile?.displayName ??
            formatFullName(link.teamLead.firstName, link.teamLead.lastName, 'Тимлид'),
          creatorCount: 0,
          totalPayment: 0
        };

      existing.creatorCount += 1;
      existing.totalPayment +=
        creatorSummaries.find((item) => item.creatorUserId === link.creator.id)?.totalPayment ?? 0;
      teamLeadMap.set(teamLeadUserId, existing);
    }

    return {
      monthKey,
      totals,
      totalPayment: creatorSummaries.reduce((sum, item) => sum + item.totalPayment, 0),
      creators: creatorSummaries,
      teamLeads: Array.from(teamLeadMap.values())
    };
  }

  async getGlobalPaymentsReport(monthKey: string): Promise<AdminReportSummary> {
    const creators = await this.userRepository.listActiveCreators();
    const submittedReports = this.weeklyStatsRepository
      ? await this.weeklyStatsRepository.listSubmittedReportsForCreators(
          creators.map((creator) => creator.id),
          monthKey
        )
      : [];
    const submittedCreatorIds = new Set(submittedReports.map((report) => report.creatorUserId));

    const creatorSummaries = (
      await Promise.all(
        creators.map(async (creator) => {
          const [aggregation, payment] = await Promise.all([
            this.aggregationService.aggregateCreatorMonth(creator.id, monthKey, { submittedOnly: true }),
            this.paymentService.calculateForCreatorMonth(creator.id, monthKey, {
              submittedOnly: true,
              persistSnapshot: false
            })
          ]);
          const hasSubmittedStats = submittedCreatorIds.has(creator.id);
          const hasPaymentData = payment.totalPayment > 0 || aggregation.monthlyVideoSubmitted;

          if (!hasSubmittedStats && !hasPaymentData) {
            return null;
          }

          const invoiceTotalPayment = getCreatorInvoiceDisplayAmount(payment.totalPayment);

          return {
            creatorUserId: creator.id,
            creatorName:
              creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, 'Креатор'),
            monthKey,
            totals: aggregation.totals,
            totalPayment: invoiceTotalPayment,
            baseTotalPayment: payment.totalPayment,
            invoiceSurcharge: CREATOR_INVOICE_MESSAGE_SURCHARGE,
            invoiceTotalPayment,
            weeklyReportCount: aggregation.weeklyReportCount,
            monthlyVideoCount: aggregation.monthlyVideoCount,
            monthlyVideoSubmitted: aggregation.monthlyVideoSubmitted,
            payment
          };
        })
      )
    ).filter((item): item is NonNullable<typeof item> => Boolean(item));

    const totals = creatorSummaries.reduce(
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
      monthKey,
      totals,
      totalPayment: creatorSummaries.reduce((sum, item) => sum + item.totalPayment, 0),
      creators: creatorSummaries,
      teamLeads: []
    };
  }
}
