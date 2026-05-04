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

const PLATFORM_LABEL_ORDER = new Map([
  ['Instagram', 0],
  ['TikTok', 1],
  ['VK', 2],
  ['YouTube', 3]
]);

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
    const rows = this.sortReports(reports).flatMap((report) => {
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

    return rows.sort((left, right) => {
      const monthCompare = String(right.values[7] ?? '').localeCompare(String(left.values[7] ?? ''));

      if (monthCompare !== 0) {
        return monthCompare;
      }

      const leftPlatformOrder = PLATFORM_LABEL_ORDER.get(String(left.values[4] ?? '')) ?? 99;
      const rightPlatformOrder = PLATFORM_LABEL_ORDER.get(String(right.values[4] ?? '')) ?? 99;

      if (leftPlatformOrder !== rightPlatformOrder) {
        return leftPlatformOrder - rightPlatformOrder;
      }

      const creatorCompare = String(left.values[5] ?? '').localeCompare(String(right.values[5] ?? ''), 'ru');

      if (creatorCompare !== 0) {
        return creatorCompare;
      }

      return String(left.values[8] ?? '').localeCompare(String(right.values[8] ?? ''));
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
