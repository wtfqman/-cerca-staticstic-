import { SocialPlatform } from '@prisma/client';

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

const PLATFORM_ORDER = [
  SocialPlatform.INSTAGRAM,
  SocialPlatform.TIKTOK,
  SocialPlatform.VK,
  SocialPlatform.YOUTUBE
] as const;

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
    const reports = await this.weeklyStatsRepository.listReportsForSheetSync(filters);
    const definition = this.formatter.getStatsSheetDefinition();

    return this.googleSheetsService.upsertRows(definition, this.buildRows(reports));
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const reports = await this.weeklyStatsRepository.listReportsForSheetSync();
    const definition = this.formatter.getStatsSheetDefinition();

    return this.googleSheetsService.rebuildSheet(definition, this.buildRows(reports));
  }

  private buildRows(reports: Awaited<ReturnType<WeeklyStatsRepository['listReportsForSheetSync']>>) {
    return this.sortReports(reports).flatMap((report) => {
      const itemsByPlatform = new Map(report.items.map((item) => [item.platform, item]));
      const creatorName = formatCreatorDisplayName(report.creator);
      const teamLeadName = formatAssignedTeamLeadName(report.creator);

      return PLATFORM_ORDER.map((platform) => {
        const item = itemsByPlatform.get(platform);
        const updatedAt = item && item.updatedAt > report.updatedAt ? item.updatedAt : report.updatedAt;

        return this.formatter.buildStatsRow({
          weeklyStatItemId: `${report.id}:${platform}`,
          weeklyReportId: report.id,
          creatorUserId: report.creatorUserId,
          creatorName,
          teamLeadName,
          monthKey: report.monthKey,
          weekStart: toDateKey(report.weekStart),
          weekEnd: toDateKey(report.weekEnd),
          platform,
          videoCount: report.totalVideoCount ?? item?.videoCount ?? 0,
          views: item?.views ?? 0,
          likes: item?.likes ?? 0,
          comments: item?.comments ?? 0,
          reposts: item?.reposts ?? 0,
          saves: item?.saves ?? 0,
          reportStatus: report.status,
          reviewStatus: formatReviewStatus(report.status, report.reviewedAt),
          reviewedByTeamLeadName: report.reviewedByTeamLead
            ? formatTeamLeadDisplayName(report.reviewedByTeamLead)
            : '',
          reviewedAt: formatRussianDateTime(report.reviewedAt),
          submittedAt: formatRussianDateTime(report.submittedAt),
          updatedAt: formatRussianDateTime(updatedAt)
        });
      });
    });
  }

  private sortReports(reports: Awaited<ReturnType<WeeklyStatsRepository['listReportsForSheetSync']>>) {
    return [...reports].sort((left, right) => {
      const creatorCompare = formatCreatorDisplayName(left.creator).localeCompare(
        formatCreatorDisplayName(right.creator),
        'ru'
      );

      if (creatorCompare !== 0) {
        return creatorCompare;
      }

      const monthCompare = left.monthKey.localeCompare(right.monthKey);

      if (monthCompare !== 0) {
        return monthCompare;
      }

      return left.weekStart.getTime() - right.weekStart.getTime();
    });
  }
}
