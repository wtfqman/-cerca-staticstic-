import { SocialPlatform } from '@prisma/client';

import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { mapInBatches } from '../utils/batch';
import {
  formatAssignedTeamLeadName,
  formatCreatorDisplayName,
  formatRussianDateTime
} from '../utils/formatters';
import { toDateKey } from '../utils/periods';
import { GoogleSheetsService, type SheetRow, type SheetUpsertResult } from './google-sheets.service';
import { SpreadsheetFormatterService } from './spreadsheet-formatter.service';
import type { StatsSheetSyncFilters } from './stats-sheet-sync.service';

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

type SheetReport = Awaited<ReturnType<WeeklyStatsRepository['listReportsForSheetSync']>>[number];

const toCreatorMonthKey = (creatorUserId: string, monthKey: string) => `${creatorUserId}:${monthKey}`;

const sortRows = (rows: SheetRow[]) =>
  [...rows].sort((left, right) => {
    const monthCompare = String(right.values[5] ?? '').localeCompare(String(left.values[5] ?? ''));

    if (monthCompare !== 0) {
      return monthCompare;
    }

    const platformCompare =
      (PLATFORM_LABEL_ORDER.get(String(left.values[2] ?? '')) ?? 99) -
      (PLATFORM_LABEL_ORDER.get(String(right.values[2] ?? '')) ?? 99);

    if (platformCompare !== 0) {
      return platformCompare;
    }

    return String(left.values[3] ?? '').localeCompare(String(right.values[3] ?? ''), 'ru');
  });

const getLatestDate = (reports: SheetReport[], platform: SocialPlatform) => {
  let latestDate: Date | null = null;

  for (const report of reports) {
    const item = report.items.find((candidate) => candidate.platform === platform);
    const dates = [report.updatedAt, item?.updatedAt].filter((date): date is Date => Boolean(date));

    for (const date of dates) {
      if (!latestDate || date > latestDate) {
        latestDate = date;
      }
    }
  }

  return latestDate;
};

export class SocialsSheetSyncService {
  constructor(
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly monthlyVideoRepository: MonthlyVideoRepository,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly formatter: SpreadsheetFormatterService
  ) {}

  async prepareSheet() {
    await this.googleSheetsService.ensureSheet(this.formatter.getSocialsSheetDefinition());
  }

  async sync(filters: StatsSheetSyncFilters = {}): Promise<SheetUpsertResult> {
    const reports = await this.listReports(filters);
    const rows = await this.buildRows(reports);

    return this.googleSheetsService.upsertRows(this.formatter.getSocialsSheetDefinition(), rows);
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const reports = await this.weeklyStatsRepository.listReportsForSheetSync();
    const rows = await this.buildRows(reports);

    return this.googleSheetsService.rebuildSheet(this.formatter.getSocialsSheetDefinition(), rows);
  }

  private async listReports(filters: StatsSheetSyncFilters) {
    if (filters.creatorUserId && filters.monthKey) {
      return this.weeklyStatsRepository.listReportsForSheetSync({
        creatorUserId: filters.creatorUserId,
        monthKey: filters.monthKey
      });
    }

    if (filters.reportId) {
      const report = await this.weeklyStatsRepository.getReportByIdWithRelations(filters.reportId);

      if (!report) {
        return [];
      }

      return this.weeklyStatsRepository.listReportsForSheetSync({
        creatorUserId: report.creatorUserId,
        monthKey: report.monthKey
      });
    }

    return this.weeklyStatsRepository.listReportsForSheetSync(filters);
  }

  private async buildRows(reports: SheetReport[]) {
    const groups = new Map<string, SheetReport[]>();

    for (const report of reports) {
      const key = toCreatorMonthKey(report.creatorUserId, report.monthKey);
      groups.set(key, [...(groups.get(key) ?? []), report]);
    }

    const monthlyVideos = new Map<string, number>();
    await mapInBatches(Array.from(groups.keys()), 20, async (key) => {
      const [creatorUserId, monthKey] = key.split(':');
      const record = await this.monthlyVideoRepository.findByCreatorAndMonth(creatorUserId, monthKey);

      if (record) {
        monthlyVideos.set(key, record.videoCount);
      }
    });

    const rows: SheetRow[] = [];

    for (const [creatorMonthKey, creatorMonthReports] of groups) {
      const sortedReports = [...creatorMonthReports].sort(
        (left, right) => left.weekStart.getTime() - right.weekStart.getTime()
      );
      const firstReport = sortedReports[0];
      const creatorName = formatCreatorDisplayName(firstReport.creator);
      const teamLeadName = formatAssignedTeamLeadName(firstReport.creator);

      for (const platform of PLATFORM_ORDER) {
        const weeks = sortedReports.map((report) => {
          const item = report.items.find((candidate) => candidate.platform === platform);

          return {
            period: `${toDateKey(report.weekStart)} - ${toDateKey(report.weekEnd)}`,
            views: item?.views ?? 0,
            likes: item?.likes ?? 0,
            comments: item?.comments ?? 0,
            reposts: item?.reposts ?? 0,
            saves: item?.saves ?? 0
          };
        });

        rows.push(
          this.formatter.buildSocialsRow({
            syncKey: `${creatorMonthKey}:${platform}`,
            creatorUserId: firstReport.creatorUserId,
            platform,
            creatorName,
            teamLeadName,
            monthKey: firstReport.monthKey,
            weeks,
            totalViews: weeks.reduce((total, week) => total + week.views, 0),
            totalLikes: weeks.reduce((total, week) => total + week.likes, 0),
            totalComments: weeks.reduce((total, week) => total + week.comments, 0),
            totalReposts: weeks.reduce((total, week) => total + week.reposts, 0),
            totalSaves: weeks.reduce((total, week) => total + week.saves, 0),
            monthlyVideoCount: monthlyVideos.get(creatorMonthKey) ?? null,
            updatedAt: formatRussianDateTime(getLatestDate(sortedReports, platform))
          })
        );
      }
    }

    return sortRows(rows);
  }
}
