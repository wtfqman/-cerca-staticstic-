import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { toDateKey } from '../utils/periods';
import {
  formatAssignedTeamLeadName,
  formatCreatorDisplayName,
  formatRussianDateTime,
  formatTeamLeadDisplayName
} from '../utils/formatters';
import { GoogleSheetsService, type SheetUpsertResult } from './google-sheets.service';
import { SpreadsheetFormatterService } from './spreadsheet-formatter.service';

export interface StatsSheetSyncFilters {
  reportId?: string;
  creatorUserId?: string;
  creatorIds?: string[];
  monthKey?: string;
}

const formatReviewStatus = (status: string, reviewedAt?: Date | null) => {
  if (reviewedAt) {
    return 'Проверено';
  }

  if (status === 'SUBMITTED' || status === 'CONFIRMED') {
    return 'Ожидает проверки';
  }

  return 'Не отправлено';
};

export class StatsSheetSyncService {
  constructor(
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly formatter: SpreadsheetFormatterService
  ) {}

  async prepareSheet() {
    await this.googleSheetsService.ensureSheet(this.formatter.getStatsSheetDefinition());
  }

  async sync(filters: StatsSheetSyncFilters = {}): Promise<SheetUpsertResult> {
    const items = await this.weeklyStatsRepository.listItemsForSheetSync(filters);
    const definition = this.formatter.getStatsSheetDefinition();

    return this.googleSheetsService.upsertRows(
      definition,
      items.map((item) =>
        this.formatter.buildStatsRow({
          weeklyStatItemId: item.id,
          weeklyReportId: item.weeklyReportId,
          creatorUserId: item.report.creatorUserId,
          creatorName: formatCreatorDisplayName(item.report.creator),
          teamLeadName: formatAssignedTeamLeadName(item.report.creator),
          monthKey: item.report.monthKey,
          weekStart: toDateKey(item.report.weekStart),
          weekEnd: toDateKey(item.report.weekEnd),
          platform: item.platform,
          videoCount: item.report.totalVideoCount ?? item.videoCount,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          reposts: item.reposts,
          saves: item.saves,
          reportStatus: item.report.status,
          reviewStatus: formatReviewStatus(item.report.status, item.report.reviewedAt),
          reviewedByTeamLeadName: item.report.reviewedByTeamLead
            ? formatTeamLeadDisplayName(item.report.reviewedByTeamLead)
            : '',
          reviewedAt: formatRussianDateTime(item.report.reviewedAt),
          submittedAt: formatRussianDateTime(item.report.submittedAt),
          updatedAt: formatRussianDateTime(
            item.updatedAt > item.report.updatedAt ? item.updatedAt : item.report.updatedAt
          )
        })
      )
    );
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const items = await this.weeklyStatsRepository.listItemsForSheetSync();
    const definition = this.formatter.getStatsSheetDefinition();

    return this.googleSheetsService.rebuildSheet(
      definition,
      items.map((item) =>
        this.formatter.buildStatsRow({
          weeklyStatItemId: item.id,
          weeklyReportId: item.weeklyReportId,
          creatorUserId: item.report.creatorUserId,
          creatorName: formatCreatorDisplayName(item.report.creator),
          teamLeadName: formatAssignedTeamLeadName(item.report.creator),
          monthKey: item.report.monthKey,
          weekStart: toDateKey(item.report.weekStart),
          weekEnd: toDateKey(item.report.weekEnd),
          platform: item.platform,
          videoCount: item.report.totalVideoCount ?? item.videoCount,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          reposts: item.reposts,
          saves: item.saves,
          reportStatus: item.report.status,
          reviewStatus: formatReviewStatus(item.report.status, item.report.reviewedAt),
          reviewedByTeamLeadName: item.report.reviewedByTeamLead
            ? formatTeamLeadDisplayName(item.report.reviewedByTeamLead)
            : '',
          reviewedAt: formatRussianDateTime(item.report.reviewedAt),
          submittedAt: formatRussianDateTime(item.report.submittedAt),
          updatedAt: formatRussianDateTime(
            item.updatedAt > item.report.updatedAt ? item.updatedAt : item.report.updatedAt
          )
        })
      )
    );
  }
}
