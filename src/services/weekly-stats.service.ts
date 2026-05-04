import { SocialPlatform, WeeklyReportStatus } from '@prisma/client';

import type { WeeklyReportReviewSummary, WeeklyStatSummary } from '../types/report.types';
import { getMonthRange, getWeeklyReportPeriod, toDateOnly, toDateKey } from '../utils/periods';
import { formatTeamLeadDisplayName } from '../utils/formatters';
import { kpiViewsSchema, nonNegativeIntSchema } from '../validators/stats.schemas';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import { FileStorageService } from './file-storage.service';
import type { Telegram } from 'telegraf';

export interface WeeklyStatItemInput {
  platform: SocialPlatform;
  videoCount: number;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
}

const buildTotals = (
  items: Array<Omit<WeeklyStatItemInput, 'platform'>>,
  totalVideoCount?: number | null
) => ({
  videoCount: totalVideoCount ?? items.reduce((sum, item) => sum + item.videoCount, 0),
  views: items.reduce((sum, item) => sum + item.views, 0),
  likes: items.reduce((sum, item) => sum + item.likes, 0),
  comments: items.reduce((sum, item) => sum + item.comments, 0),
  reposts: items.reduce((sum, item) => sum + item.reposts, 0),
  saves: items.reduce((sum, item) => sum + item.saves, 0)
});

const REVIEWABLE_WEEKLY_STATUSES = new Set<string>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);

const isTemporaryReachBackfillReport = (report: WeeklyReportWithItems | WeeklyReportWithRelations) => {
  const monthRange = getMonthRange(report.monthKey);

  return (
    toDateKey(report.weekStart) === monthRange.dateFrom &&
    toDateKey(report.weekEnd) === monthRange.dateTo &&
    report.items.some((item) => item.views > 0) &&
    report.items.every(
      (item) =>
        item.videoCount === 0 &&
        item.likes === 0 &&
        item.comments === 0 &&
        item.reposts === 0 &&
        item.saves === 0
    )
  );
};

type WeeklyReportWithItems = NonNullable<Awaited<ReturnType<WeeklyStatsRepository['getReportById']>>>;
type WeeklyReportWithRelations = NonNullable<
  Awaited<ReturnType<WeeklyStatsRepository['getReportByIdWithRelations']>>
>;

export interface WeeklyReportReviewResult {
  alreadyReviewed: boolean;
  report: WeeklyReportReviewSummary;
}

export class WeeklyStatsService {
  private readonly attachmentSaveLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: WeeklyStatsRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly googleSheetsSyncService?: GoogleSheetsSyncService
  ) {}

  async getOrCreateCurrentReport(creatorUserId: string) {
    const period = getWeeklyReportPeriod();
    return this.repository.findOrCreateReport(
      creatorUserId,
      period.monthKey,
      toDateOnly(period.weekStart),
      toDateOnly(period.weekEnd)
    );
  }

  async savePlatformStats(reportId: string, input: WeeklyStatItemInput) {
    Object.values(input).forEach((value) => {
      if (typeof value === 'number') {
        nonNegativeIntSchema.parse(value);
      }
    });
    kpiViewsSchema.parse(input.views);

    return this.repository.upsertItem(reportId, input);
  }

  async saveTotalVideoCount(reportId: string, totalVideoCount: number) {
    nonNegativeIntSchema.parse(totalVideoCount);
    return this.repository.updateReportTotalVideoCount(reportId, totalVideoCount);
  }

  async saveAttachment(params: {
    telegram: Telegram;
    reportId: string;
    creatorUserId: string;
    telegramFileId: string;
    telegramFileUniqueId?: string;
  }) {
    return this.withAttachmentSaveLock(params.reportId, async () => {
      const report = await this.repository.getReportById(params.reportId);

      if (!report || report.creatorUserId !== params.creatorUserId) {
        throw new Error('Недельный отчет для загрузки скрина не найден.');
      }

      const fileLink = await params.telegram.getFileLink(params.telegramFileId);
      const response = await fetch(fileLink.toString());

      if (!response.ok) {
        throw new Error('Не удалось скачать скрин из Telegram.');
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length === 0) {
        throw new Error('Не удалось сохранить пустой файл. Отправь скрин еще раз.');
      }

      const sortOrder = (await this.repository.countAttachments(params.reportId)) + 1;
      const stored = await this.fileStorageService.saveWeeklyStatAttachment({
        creatorUserId: params.creatorUserId,
        weeklyReportId: params.reportId,
        buffer,
        sortOrder,
        telegramFileUniqueId: params.telegramFileUniqueId
      });

      return this.repository.createAttachment({
        weeklyReportId: params.reportId,
        creatorUserId: params.creatorUserId,
        telegramFileId: params.telegramFileId,
        telegramFileUniqueId: params.telegramFileUniqueId,
        filePath: stored.filePath,
        sortOrder
      });
    });
  }

  async listAttachments(reportId: string) {
    return this.repository.listAttachmentsByReport(reportId);
  }

  async countAttachments(reportId: string) {
    return this.repository.countAttachments(reportId);
  }

  async submitReport(reportId: string): Promise<WeeklyStatSummary> {
    const report = await this.repository.submitReport(reportId);
    const summary = this.toSummary(report);

    await this.googleSheetsSyncService?.safeSyncWeeklyReport(report.id, report.creatorUserId, report.monthKey);

    return summary;
  }

  async getReportSummary(reportId: string): Promise<WeeklyStatSummary | null> {
    const report = await this.repository.getReportById(reportId);
    return report ? this.toSummary(report) : null;
  }

  async getCurrentWeeklySummary(creatorUserId: string): Promise<WeeklyStatSummary> {
    const report = await this.getOrCreateCurrentReport(creatorUserId);
    return this.toSummary(report);
  }

  async listRecentSummaries(creatorUserId: string): Promise<WeeklyStatSummary[]> {
    const reports = await this.repository.listRecentReportsByCreator(creatorUserId);
    return reports.map((report) => this.toSummary(report));
  }

  async listReviewSummariesForCreatorMonth(
    creatorUserId: string,
    monthKey: string
  ): Promise<WeeklyReportReviewSummary[]> {
    const reports = await this.repository.listReportsByCreatorAndMonth(creatorUserId, monthKey);
    return reports.map((report) => this.toReviewSummary(report));
  }

  async markReportReviewedByTeamLead(
    reportId: string,
    teamLeadUserId: string
  ): Promise<WeeklyReportReviewResult> {
    const report = await this.repository.getReportByIdWithRelations(reportId);

    if (!report) {
      throw new Error('Недельный отчет не найден.');
    }

    const hasAccess = report.creator.creatorAssignments.some(
      (assignment) => assignment.teamLeadUserId === teamLeadUserId
    );

    if (!hasAccess) {
      throw new Error('У тебя нет доступа к этой статистике.');
    }

    if (!REVIEWABLE_WEEKLY_STATUSES.has(report.status)) {
      throw new Error('Статистика еще не отправлена, ее нельзя отметить проверенной.');
    }

    if (report.reviewedAt) {
      return {
        alreadyReviewed: true,
        report: this.toReviewSummary(report)
      };
    }

    const updated = await this.repository.markReportReviewedByTeamLead(report.id, teamLeadUserId);

    return {
      alreadyReviewed: false,
      report: this.toReviewSummary(updated)
    };
  }

  private toSummary(report: WeeklyReportWithItems): WeeklyStatSummary {
    const items = report.items.map((item) => ({
      platform: item.platform,
      videoCount: item.videoCount,
      views: item.views,
      likes: item.likes,
      comments: item.comments,
      reposts: item.reposts,
      saves: item.saves
    }));

    return {
      reportId: report.id,
      creatorUserId: report.creatorUserId,
      monthKey: report.monthKey,
      weekStart: toDateKey(report.weekStart),
      weekEnd: toDateKey(report.weekEnd),
      status: report.status,
      totalVideoCount: report.totalVideoCount ?? items.reduce((sum, item) => sum + item.videoCount, 0),
      isReviewedByTeamLead: Boolean(report.reviewedAt),
      reviewedByTeamLeadId: report.reviewedByTeamLeadId ?? undefined,
      reviewedByTeamLeadName: report.reviewedByTeamLead
        ? formatTeamLeadDisplayName(report.reviewedByTeamLead)
        : undefined,
      reviewedAt: report.reviewedAt?.toISOString(),
      attachmentCount: report.attachments.length,
      attachments: report.attachments.map((attachment) => ({
        id: attachment.id,
        telegramFileId: attachment.telegramFileId,
        telegramFileUniqueId: attachment.telegramFileUniqueId ?? undefined,
        filePath: attachment.filePath ?? undefined,
        sortOrder: attachment.sortOrder,
        uploadedAt: attachment.uploadedAt.toISOString()
      })),
      items,
      totals: buildTotals(items, report.totalVideoCount)
    };
  }

  private toReviewSummary(report: WeeklyReportWithItems | WeeklyReportWithRelations): WeeklyReportReviewSummary {
    const items = report.items.map((item) => ({
      platform: item.platform,
      videoCount: item.videoCount,
      views: item.views,
      likes: item.likes,
      comments: item.comments,
      reposts: item.reposts,
      saves: item.saves
    }));

    return {
      reportId: report.id,
      creatorUserId: report.creatorUserId,
      monthKey: report.monthKey,
      weekStart: toDateKey(report.weekStart),
      weekEnd: toDateKey(report.weekEnd),
      status: report.status,
      isReviewedByTeamLead: Boolean(report.reviewedAt),
      reviewedByTeamLeadId: report.reviewedByTeamLeadId ?? undefined,
      reviewedByTeamLeadName: report.reviewedByTeamLead
        ? formatTeamLeadDisplayName(report.reviewedByTeamLead)
        : undefined,
      reviewedAt: report.reviewedAt?.toISOString(),
      attachmentCount: report.attachments.length,
      totalVideoCount: report.totalVideoCount ?? items.reduce((sum, item) => sum + item.videoCount, 0),
      isTemporaryReachBackfill: isTemporaryReachBackfillReport(report),
      totals: buildTotals(items, report.totalVideoCount),
      items
    };
  }

  private async withAttachmentSaveLock<T>(reportId: string, task: () => Promise<T>) {
    const previous = this.attachmentSaveLocks.get(reportId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.attachmentSaveLocks.set(reportId, current);
    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseLock();

      if (this.attachmentSaveLocks.get(reportId) === current) {
        this.attachmentSaveLocks.delete(reportId);
      }
    }
  }
}
