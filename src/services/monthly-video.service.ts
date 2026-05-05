import { config } from '../config';
import { getCurrentMonthKey, getNow } from '../utils/periods';
import { monthKeySchema, videoCountSchema } from '../validators/stats.schemas';
import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';

export class MonthlyVideoService {
  constructor(
    private readonly repository: MonthlyVideoRepository,
    private readonly googleSheetsSyncService?: GoogleSheetsSyncService
  ) {}

  async saveMonthlyCount(
    creatorUserId: string,
    monthKey: string,
    videoCount: number,
    options: { force?: boolean } = {}
  ) {
    monthKeySchema.parse(monthKey);
    videoCountSchema.parse(videoCount);

    if (!options.force && !this.canEditMonth(monthKey)) {
      throw new Error('Срок редактирования количества видео за этот месяц уже закрыт');
    }

    const record = await this.repository.upsert(creatorUserId, monthKey, videoCount);
    await this.googleSheetsSyncService?.safeSyncPaymentsForCreatorMonth(creatorUserId, monthKey);
    return record;
  }

  getMonthCount(creatorUserId: string, monthKey: string) {
    return this.repository.findByCreatorAndMonth(creatorUserId, monthKey);
  }

  listRecentCounts(creatorUserId: string) {
    return this.repository.listRecentByCreator(creatorUserId);
  }

  getSuggestedMonthOptions() {
    return [getCurrentMonthKey(), getNow().subtract(1, 'month').format('YYYY-MM')];
  }

  private canEditMonth(monthKey: string) {
    const currentMonthKey = getCurrentMonthKey();

    if (monthKey === currentMonthKey) {
      return true;
    }

    const previousMonthKey = getNow().subtract(1, 'month').format('YYYY-MM');
    return monthKey === previousMonthKey && getNow().date() <= config.limits.maxMonthlyVideoEditDay;
  }
}
