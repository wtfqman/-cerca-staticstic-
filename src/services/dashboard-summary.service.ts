import type { AdminDashboardSummary } from '../types/report.types';
import { UserRepository } from '../repositories/user.repository';
import { mapInBatches } from '../utils/batch';
import { getWeeklyReportPeriod } from '../utils/periods';
import { CreatorDisciplineService } from './creator-discipline.service';
import { DocumentStatusService } from './document-status.service';
import { PaymentCalculationService } from './payment-calculation.service';

export class DashboardSummaryService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly creatorDisciplineService: CreatorDisciplineService,
    private readonly documentStatusService: DocumentStatusService,
    private readonly paymentCalculationService: PaymentCalculationService
  ) {}

  async getAdminSummary(monthKey: string): Promise<AdminDashboardSummary> {
    const [creators, roleCounts] = await Promise.all([
      this.userRepository.listActiveCreators(),
      this.userRepository.getCountsByRole()
    ]);
    const weekPeriod = getWeeklyReportPeriod();
    const [weeklyStats, monthlyVideoStatuses, documentSummaries, payments] = await Promise.all([
      this.creatorDisciplineService.getMonthWeeklySubmissionStats(creators, monthKey),
      this.creatorDisciplineService.getMonthlyVideoStatuses(creators, monthKey),
      this.documentStatusService.getSummariesForCreators(creators, monthKey),
      mapInBatches(creators, 10, async (creator) =>
        this.paymentCalculationService.calculateForCreatorMonth(creator.id, monthKey, {
          submittedOnly: true,
          persistSnapshot: false
        })
      )
    ]);

    return {
      monthKey,
      weekStart: weekPeriod.weekStart,
      weekEnd: weekPeriod.weekEnd,
      activeCreators: creators.length,
      teamLeads: roleCounts.teamLeads,
      weeklyReportsSubmitted: weeklyStats.submitted,
      weeklyReportsAbsent: weeklyStats.absent,
      monthlyVideosSubmitted: monthlyVideoStatuses.filter((item) => item.status === 'SUBMITTED').length,
      monthlyVideosMissing: monthlyVideoStatuses.filter((item) => item.status === 'MISSING').length,
      documentsGenerated: documentSummaries.reduce(
        (sum, summary) => sum + summary.monthly.filter((item) => item.generated).length,
        0
      ),
      documentsSigned: documentSummaries.reduce(
        (sum, summary) => sum + summary.monthly.filter((item) => item.signed).length,
        0
      ),
      documentsNotReturned: documentSummaries.reduce(
        (sum, summary) => sum + summary.monthly.filter((item) => !item.signed).length,
        0
      ),
      totalPayment: payments.reduce((sum, payment) => sum + payment.totalPayment, 0)
    };
  }
}
