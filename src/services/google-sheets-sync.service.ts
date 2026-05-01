import { logger } from '../lib/logger';
import { normalizeErrorForLog } from '../utils/error-logging';
import { GoogleSheetsService } from './google-sheets.service';
import { DocumentsSheetSyncService, type DocumentsSheetSyncFilters } from './documents-sheet-sync.service';
import { PaymentsSheetSyncService } from './payments-sheet-sync.service';
import { StatsSheetSyncService, type StatsSheetSyncFilters } from './stats-sheet-sync.service';

export type GoogleSheetsTarget = 'stats' | 'payments' | 'documents';

export class GoogleSheetsSyncService {
  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly statsSheetSyncService: StatsSheetSyncService,
    private readonly paymentsSheetSyncService: PaymentsSheetSyncService,
    private readonly documentsSheetSyncService: DocumentsSheetSyncService
  ) {}

  isEnabled() {
    return this.googleSheetsService.isEnabled();
  }

  async testConnection() {
    this.ensureEnabled();
    await this.prepareConfiguredSheets();
    return this.googleSheetsService.testConnection();
  }

  async syncStats(filters: StatsSheetSyncFilters = {}) {
    this.ensureEnabled();
    return this.statsSheetSyncService.sync(filters);
  }

  async syncPayments(params: {
    creatorUserId?: string;
    creatorIds?: string[];
    monthKey?: string;
  } = {}) {
    this.ensureEnabled();

    if (params.creatorUserId) {
      if (!params.monthKey) {
        throw new Error('Для синхронизации выплат конкретного креатора нужен monthKey');
      }

      return this.paymentsSheetSyncService.syncCreatorMonth(params.creatorUserId, params.monthKey);
    }

    if (params.monthKey) {
      return this.paymentsSheetSyncService.syncMonth(params.monthKey, params.creatorIds);
    }

    return this.paymentsSheetSyncService.syncAll();
  }

  async syncDocuments(filters: DocumentsSheetSyncFilters = {}) {
    this.ensureEnabled();
    return this.documentsSheetSyncService.sync(filters);
  }

  async syncAll() {
    this.ensureEnabled();

    const stats = await this.statsSheetSyncService.sync();
    const payments = await this.paymentsSheetSyncService.syncAll();
    const documents = await this.documentsSheetSyncService.sync();

    return {
      stats,
      payments,
      documents
    };
  }

  async rebuildSheet(target: GoogleSheetsTarget) {
    this.ensureEnabled();

    switch (target) {
      case 'stats':
        return this.statsSheetSyncService.rebuild();
      case 'payments':
        return this.paymentsSheetSyncService.rebuild();
      case 'documents':
        return this.documentsSheetSyncService.rebuild();
      default:
        throw new Error(`Неизвестный лист для пересборки: ${target}`);
    }
  }

  async prepareConfiguredSheets() {
    this.ensureEnabled();

    await Promise.all([
      this.statsSheetSyncService.prepareSheet(),
      this.paymentsSheetSyncService.prepareSheet(),
      this.documentsSheetSyncService.prepareSheet()
    ]);
  }

  async safeSyncWeeklyReport(reportId: string, creatorUserId: string, monthKey: string) {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const [stats, payments] = await Promise.all([
        this.statsSheetSyncService.sync({ reportId }),
        this.paymentsSheetSyncService.syncCreatorMonth(creatorUserId, monthKey)
      ]);

      return { stats, payments };
    } catch (error) {
      logger.error(
        { error: normalizeErrorForLog(error), reportId, creatorUserId, monthKey },
        'Automatic Google Sheets sync for weekly report failed'
      );
      return null;
    }
  }

  async safeSyncPaymentsForCreatorMonth(creatorUserId: string, monthKey: string) {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      return await this.paymentsSheetSyncService.syncCreatorMonth(creatorUserId, monthKey);
    } catch (error) {
      logger.error(
        { error: normalizeErrorForLog(error), creatorUserId, monthKey },
        'Automatic Google Sheets sync for payments failed'
      );
      return null;
    }
  }

  async safeSyncDocuments(documentIds: string[]) {
    if (!this.isEnabled() || documentIds.length === 0) {
      return null;
    }

    try {
      return await this.documentsSheetSyncService.sync({ documentIds });
    } catch (error) {
      logger.error(
        { error: normalizeErrorForLog(error), documentIds },
        'Automatic Google Sheets sync for documents failed'
      );
      return null;
    }
  }

  private ensureEnabled() {
    if (!this.isEnabled()) {
      throw new Error('Синхронизация Google Sheets отключена. Установите GOOGLE_SHEETS_SYNC_ENABLED=true');
    }
  }
}
