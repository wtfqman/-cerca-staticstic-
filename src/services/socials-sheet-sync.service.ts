import { SocialPlatform, WeeklyReportStatus } from '@prisma/client';

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
import { SpreadsheetFormatterService, type SocialsSheetWeekInput } from './spreadsheet-formatter.service';
import type { StatsSheetSyncFilters } from './stats-sheet-sync.service';

const SOCIALS_MATRIX_START_MONTH_KEY = '2026-05';
const SOCIALS_WEEK_SLOT_COUNT = 6;

const SUBMITTED_WEEKLY_STATUSES = new Set<WeeklyReportStatus>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);

const PLATFORM_ORDER = [
  SocialPlatform.INSTAGRAM,
  SocialPlatform.TIKTOK,
  SocialPlatform.VK,
  SocialPlatform.YOUTUBE
] as const;

const PLATFORM_LABEL_ORDER = new Map([
  [SocialPlatform.INSTAGRAM, 0],
  [SocialPlatform.TIKTOK, 1],
  [SocialPlatform.VK, 2],
  [SocialPlatform.YOUTUBE, 3]
]);

type SheetReport = Awaited<ReturnType<WeeklyStatsRepository['listReportsForSheetSync']>>[number];

const toCreatorMonthKey = (creatorUserId: string, monthKey: string) => `${creatorUserId}:${monthKey}`;
const toPlatformMonthKey = (monthKey: string, platform: SocialPlatform) => `${monthKey}:${platform}`;

const hasMetricData = (week: {
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
}) => week.views > 0 || week.likes > 0 || week.comments > 0 || week.reposts > 0 || week.saves > 0;

const getMonthStart = (monthKey: string) => new Date(`${monthKey}-01T00:00:00.000Z`);

const normalizeReportPeriod = (report: SheetReport) => {
  const monthStart = getMonthStart(report.monthKey);
  const normalizedStart = report.weekStart < monthStart ? monthStart : report.weekStart;

  return `${toDateKey(normalizedStart)} - ${toDateKey(report.weekEnd)}`;
};

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

const getReportPlatformUpdatedAt = (report: SheetReport, platform: SocialPlatform) => {
  const item = report.items.find((candidate) => candidate.platform === platform);
  const dates = [report.updatedAt, item?.updatedAt].filter((date): date is Date => Boolean(date));

  return dates.reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);
};

const buildEmptyWeek = (period: string): SocialsSheetWeekInput => ({
  period,
  views: 0,
  likes: 0,
  comments: 0,
  reposts: 0,
  saves: 0
});

const sumWeeks = (weeks: SocialsSheetWeekInput[], field: keyof Omit<SocialsSheetWeekInput, 'period'>) =>
  weeks.reduce((total, week) => total + week[field], 0);

type PendingSocialsRow = {
  syncKey: string;
  creatorUserId: string;
  platform: SocialPlatform;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  weeks: SocialsSheetWeekInput[];
  monthlyVideoCount: number | null;
  updatedAt: Date | null;
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
    void filters;

    // The matrix has platform totals, so rebuilding keeps totals and removed rows correct.
    return this.rebuild();
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const reports = await this.weeklyStatsRepository.listReportsForSheetSync();
    const rows = await this.buildRows(reports);

    return this.googleSheetsService.rebuildSheet(this.formatter.getSocialsSheetDefinition(), rows);
  }

  private async buildRows(reports: SheetReport[]) {
    const matrixReports = reports.filter(
      (report) =>
        report.monthKey >= SOCIALS_MATRIX_START_MONTH_KEY &&
        SUBMITTED_WEEKLY_STATUSES.has(report.status)
    );
    const groups = new Map<string, SheetReport[]>();

    for (const report of matrixReports) {
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

    const monthPeriods = new Map<string, Set<string>>();

    for (const report of matrixReports) {
      const period = normalizeReportPeriod(report);

      if (report.items.some((item) => hasMetricData(item))) {
        monthPeriods.set(report.monthKey, (monthPeriods.get(report.monthKey) ?? new Set()).add(period));
      }
    }

    const rowsByPlatformMonth = new Map<string, PendingSocialsRow[]>();

    for (const [creatorMonthKey, creatorMonthReports] of groups) {
      const sortedReports = [...creatorMonthReports].sort(
        (left, right) => left.weekStart.getTime() - right.weekStart.getTime()
      );
      const firstReport = sortedReports[0];
      const creatorName = formatCreatorDisplayName(firstReport.creator);
      const teamLeadName = formatAssignedTeamLeadName(firstReport.creator);

      for (const platform of PLATFORM_ORDER) {
        const latestWeekByPeriod = new Map<string, SocialsSheetWeekInput & { updatedAt: Date | null }>();

        for (const report of sortedReports) {
          const item = report.items.find((candidate) => candidate.platform === platform);

          if (!item) {
            continue;
          }

          const period = normalizeReportPeriod(report);
          const week = {
            period,
            views: item.views,
            likes: item.likes,
            comments: item.comments,
            reposts: item.reposts,
            saves: item.saves,
            updatedAt: getReportPlatformUpdatedAt(report, platform)
          };

          const current = latestWeekByPeriod.get(period);

          if (!current || (week.updatedAt && (!current.updatedAt || week.updatedAt > current.updatedAt))) {
            latestWeekByPeriod.set(period, week);
          }
        }

        if (!Array.from(latestWeekByPeriod.values()).some((week) => hasMetricData(week))) {
          continue;
        }

        const periods = Array.from(monthPeriods.get(firstReport.monthKey) ?? latestWeekByPeriod.keys())
          .sort()
          .slice(0, SOCIALS_WEEK_SLOT_COUNT);
        const weeks: SocialsSheetWeekInput[] = periods.map(
          (period) => latestWeekByPeriod.get(period) ?? buildEmptyWeek(period)
        );
        const platformMonthKey = toPlatformMonthKey(firstReport.monthKey, platform);
        rowsByPlatformMonth.set(platformMonthKey, [
          ...(rowsByPlatformMonth.get(platformMonthKey) ?? []),
          {
            syncKey: `${creatorMonthKey}:${platform}`,
            creatorUserId: firstReport.creatorUserId,
            platform,
            creatorName,
            teamLeadName,
            monthKey: firstReport.monthKey,
            weeks,
            monthlyVideoCount: monthlyVideos.get(creatorMonthKey) ?? null,
            updatedAt: getLatestDate(sortedReports, platform)
          }
        ]);
      }
    }

    return this.buildSheetRows(rowsByPlatformMonth);
  }

  private buildSheetRows(rowsByPlatformMonth: Map<string, PendingSocialsRow[]>): SheetRow[] {
    const rows: SheetRow[] = [];
    const sortedGroups = Array.from(rowsByPlatformMonth.entries()).sort(([leftKey], [rightKey]) => {
      const [leftMonth, leftPlatform] = leftKey.split(':');
      const [rightMonth, rightPlatform] = rightKey.split(':');
      const monthCompare = rightMonth.localeCompare(leftMonth);

      if (monthCompare !== 0) {
        return monthCompare;
      }

      return (
        (PLATFORM_LABEL_ORDER.get(leftPlatform as SocialPlatform) ?? 99) -
        (PLATFORM_LABEL_ORDER.get(rightPlatform as SocialPlatform) ?? 99)
      );
    });

    for (const [, groupRows] of sortedGroups) {
      const sortedRows = [...groupRows].sort((left, right) =>
        left.creatorName.localeCompare(right.creatorName, 'ru')
      );
      const firstRow = sortedRows[0];

      for (const row of sortedRows) {
        rows.push(this.buildFormattedRow(row));
      }

      const totalWeeks = firstRow.weeks.map((week, weekIndex) => ({
        period: week.period,
        views: sortedRows.reduce((total, row) => total + (row.weeks[weekIndex]?.views ?? 0), 0),
        likes: sortedRows.reduce((total, row) => total + (row.weeks[weekIndex]?.likes ?? 0), 0),
        comments: sortedRows.reduce((total, row) => total + (row.weeks[weekIndex]?.comments ?? 0), 0),
        reposts: sortedRows.reduce((total, row) => total + (row.weeks[weekIndex]?.reposts ?? 0), 0),
        saves: sortedRows.reduce((total, row) => total + (row.weeks[weekIndex]?.saves ?? 0), 0)
      }));
      const latestUpdatedAt = sortedRows.reduce<Date | null>(
        (latest, row) => (row.updatedAt && (!latest || row.updatedAt > latest) ? row.updatedAt : latest),
        null
      );

      rows.push(
        this.buildFormattedRow({
          syncKey: `socials-total:${firstRow.monthKey}:${firstRow.platform}`,
          creatorUserId: '',
          platform: firstRow.platform,
          creatorName: 'Итог',
          teamLeadName: '',
          monthKey: firstRow.monthKey,
          weeks: totalWeeks,
          monthlyVideoCount: null,
          updatedAt: latestUpdatedAt
        })
      );
    }

    return rows;
  }

  private buildFormattedRow(row: PendingSocialsRow): SheetRow {
    return this.formatter.buildSocialsRow({
      syncKey: row.syncKey,
      creatorUserId: row.creatorUserId,
      platform: row.platform,
      creatorName: row.creatorName,
      teamLeadName: row.teamLeadName,
      monthKey: row.monthKey,
      weeks: row.weeks,
      totalViews: sumWeeks(row.weeks, 'views'),
      totalLikes: sumWeeks(row.weeks, 'likes'),
      totalComments: sumWeeks(row.weeks, 'comments'),
      totalReposts: sumWeeks(row.weeks, 'reposts'),
      totalSaves: sumWeeks(row.weeks, 'saves'),
      monthlyVideoCount: row.monthlyVideoCount,
      updatedAt: formatRussianDateTime(row.updatedAt)
    });
  }
}
