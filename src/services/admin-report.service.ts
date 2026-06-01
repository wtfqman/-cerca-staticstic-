import type { AdminReportSummary } from '../types/report.types';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { UserRepository } from '../repositories/user.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { DocumentWorkflowRepository } from '../repositories/document-workflow.repository';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentCalculationService } from './payment-calculation.service';
import {
  CREATOR_INVOICE_MESSAGE_SURCHARGE,
  getCreatorInvoiceDisplayAmount
} from '../payments/payment.constants';
import { isCreatorInvoiceMonth } from '../documents/document-workflow.constants';
import { formatFullName } from '../utils/formatters';

const EMPTY_TOTALS = {
  videoCount: 0,
  views: 0,
  likes: 0,
  comments: 0,
  reposts: 0,
  saves: 0
};

const getEffectiveVideoCount = (item: {
  payment?: { actualVideoCount: number };
  monthlyVideoCount?: number;
  monthlyVideoSubmitted?: boolean;
  totals: { videoCount: number };
}) =>
  item.payment?.actualVideoCount ??
  (item.monthlyVideoSubmitted ? item.monthlyVideoCount ?? 0 : item.totals.videoCount);

export class AdminReportService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentService: PaymentCalculationService,
    private readonly weeklyStatsRepository?: WeeklyStatsRepository,
    private readonly documentWorkflowRepository?: DocumentWorkflowRepository
  ) {}

  async getCreatorReport(creatorUserId: string, monthKey: string) {
    const [creator, aggregation, payment] = await Promise.all([
      this.userRepository.findById(creatorUserId),
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey, { submittedOnly: true }),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey, {
        submittedOnly: true,
        persistSnapshot: false
      })
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
          this.aggregationService.aggregateCreatorMonth(creator.id, monthKey, { submittedOnly: true }),
          this.paymentService.calculateForCreatorMonth(creator.id, monthKey, {
            submittedOnly: true,
            persistSnapshot: false
          })
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
          this.aggregationService.aggregateCreatorMonth(creator.id, monthKey, { submittedOnly: true }),
          this.paymentService.calculateForCreatorMonth(creator.id, monthKey, {
            submittedOnly: true,
            persistSnapshot: false
          })
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
        videoCount: accumulator.videoCount + getEffectiveVideoCount(item),
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
    const creatorIds = creators.map((creator) => creator.id);
    const submittedReports = this.weeklyStatsRepository
      ? await this.weeklyStatsRepository.listSubmittedReportsForCreators(
          creatorIds,
          monthKey
        )
      : [];
    const submittedCreatorIds = new Set(submittedReports.map((report) => report.creatorUserId));
    const paymentUploads = this.documentWorkflowRepository
      ? await this.documentWorkflowRepository.listLatestPaymentUploadsForCreatorsMonth(creatorIds, monthKey)
      : [];
    const paymentUploadMap = new Map<string, (typeof paymentUploads)[number]>();

    for (const upload of paymentUploads) {
      const key = `${upload.creatorUserId}:${upload.type}`;

      if (!paymentUploadMap.has(key)) {
        paymentUploadMap.set(key, upload);
      }
    }

    const creatorSummaries = (
      await Promise.all(
        creators.map(async (creator) => {
          const invoiceUpload = paymentUploadMap.get(`${creator.id}:INVOICE`);
          const receiptUpload = paymentUploadMap.get(`${creator.id}:RECEIPT`);
          const paymentDocumentFields = {
            invoiceUploadedAt: invoiceUpload?.uploadedAt?.toISOString() ?? null,
            invoiceFileName: invoiceUpload?.originalFileName ?? null,
            receiptUploadedAt: receiptUpload?.uploadedAt?.toISOString() ?? null,
            receiptFileName: receiptUpload?.originalFileName ?? null
          };

          try {
            const [aggregation, payment] = await Promise.all([
              this.aggregationService.aggregateCreatorMonth(creator.id, monthKey, { submittedOnly: true }),
              this.paymentService.calculateForCreatorMonth(creator.id, monthKey, {
                submittedOnly: true,
                persistSnapshot: false
              })
            ]);
            const hasSubmittedStats = submittedCreatorIds.has(creator.id);
            const hasPaymentData =
              payment.totalPayment > 0 ||
              aggregation.monthlyVideoSubmitted ||
              Boolean(invoiceUpload) ||
              Boolean(receiptUpload);

            if (!hasSubmittedStats && !hasPaymentData) {
              return null;
            }

            const invoiceTotalPayment = isCreatorInvoiceMonth(monthKey)
              ? getCreatorInvoiceDisplayAmount(payment.totalPayment)
              : payment.totalPayment;
            const invoiceSurcharge = isCreatorInvoiceMonth(monthKey) ? CREATOR_INVOICE_MESSAGE_SURCHARGE : undefined;

            return {
              creatorUserId: creator.id,
              creatorName:
                creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, 'Креатор'),
              monthKey,
              totals: aggregation.totals,
              totalPayment: invoiceTotalPayment,
              baseTotalPayment: payment.totalPayment,
              invoiceSurcharge,
              invoiceTotalPayment: isCreatorInvoiceMonth(monthKey) ? invoiceTotalPayment : undefined,
              weeklyReportCount: aggregation.weeklyReportCount,
              monthlyVideoCount: aggregation.monthlyVideoCount,
              monthlyVideoSubmitted: aggregation.monthlyVideoSubmitted,
              payment,
              ...paymentDocumentFields
            };
          } catch (error) {
            if (!invoiceUpload && !receiptUpload) {
              return null;
            }

            return {
              creatorUserId: creator.id,
              creatorName:
                creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, 'Креатор'),
              monthKey,
              totals: { ...EMPTY_TOTALS },
              totalPayment: 0,
              weeklyReportCount: 0,
              monthlyVideoCount: 0,
              monthlyVideoSubmitted: false,
              calculationError: error instanceof Error ? error.message : 'неизвестная ошибка расчета',
              ...paymentDocumentFields
            };
          }
        })
      )
    ).filter((item): item is NonNullable<typeof item> => Boolean(item));

    const totals = creatorSummaries.reduce(
      (accumulator, item) => ({
        videoCount: accumulator.videoCount + getEffectiveVideoCount(item),
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
