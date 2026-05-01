import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { DailyCheckRepository } from '../repositories/daily-check.repository';
import type { TeamLeadAttentionSummary } from '../types/report.types';
import { formatCreatorDisplayName } from '../utils/formatters';
import { CreatorDisciplineService } from './creator-discipline.service';
import { DocumentStatusService } from './document-status.service';
import { getCurrentMonthKey, getWeeklyReportPeriod, toDateKey, toDateOnly } from '../utils/periods';

export class TeamLeadService {
  constructor(
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly dailyCheckRepository: DailyCheckRepository,
    private readonly creatorDisciplineService: CreatorDisciplineService,
    private readonly documentStatusService: DocumentStatusService
  ) {}

  async getGroup(teamLeadUserId: string) {
    const links = await this.teamLeadRepository.listCreatorsForTeamLead(teamLeadUserId);
    return links.map((link) => link.creator);
  }

  async getMissingConfirmation(teamLeadUserId: string, checkDate: string) {
    const creators = await this.getGroup(teamLeadUserId);
    const pending = await this.dailyCheckRepository.listPendingForCreators(
      creators.map((creator) => creator.id),
      toDateOnly(checkDate)
    );

    return pending;
  }

  async getMissingWeeklyStats(teamLeadUserId: string) {
    const creators = await this.getGroup(teamLeadUserId);
    return this.creatorDisciplineService.getWeeklyAttentionForCreators(creators);
  }

  async getMissingMonthlyVideos(teamLeadUserId: string, monthKey = getCurrentMonthKey()) {
    const creators = await this.getGroup(teamLeadUserId);
    const statuses = await this.creatorDisciplineService.getMonthlyVideoStatuses(creators, monthKey);
    return statuses.filter((item) => item.status === 'MISSING');
  }

  async getMissingDocuments(teamLeadUserId: string, monthKey = getCurrentMonthKey()) {
    const creators = await this.getGroup(teamLeadUserId);
    return this.documentStatusService.listCreatorsWithMissingSignedDocuments(creators, monthKey);
  }

  async getAttentionSummary(teamLeadUserId: string, monthKey = getCurrentMonthKey()): Promise<TeamLeadAttentionSummary> {
    const creators = await this.getGroup(teamLeadUserId);
    const weekPeriod = getWeeklyReportPeriod();
    const [missingPublicationConfirmations, weeklyStatsAttention, monthlyVideoStatuses, documentsMissing] =
      await Promise.all([
        this.getMissingConfirmation(teamLeadUserId, toDateKey(new Date())),
        this.creatorDisciplineService.getWeeklyAttentionForCreators(creators),
        this.creatorDisciplineService.getMonthlyVideoStatuses(creators, monthKey),
        this.documentStatusService.listCreatorsWithMissingSignedDocuments(creators, monthKey)
      ]);

    return {
      teamLeadUserId,
      monthKey,
      weekStart: weekPeriod.weekStart,
      weekEnd: weekPeriod.weekEnd,
      creatorsTotal: creators.length,
      missingPublicationConfirmations: missingPublicationConfirmations.map((item) => ({
        creatorUserId: item.creatorUserId,
        creatorName: formatCreatorDisplayName(item.creator),
        checkDate: item.checkDate.toISOString().slice(0, 10),
        status: item.status
      })),
      weeklyStatsAttention,
      monthlyVideoMissing: monthlyVideoStatuses.filter((item) => item.status === 'MISSING'),
      documentsMissing
    };
  }
}
