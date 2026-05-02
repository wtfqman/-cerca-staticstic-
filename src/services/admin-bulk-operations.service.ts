import type { Telegram } from 'telegraf';

import type { BulkOperationResult } from '../types/report.types';
import { logger } from '../lib/logger';
import { UserRepository } from '../repositories/user.repository';
import { CreatorDisciplineService } from './creator-discipline.service';
import { DocumentStatusService } from './document-status.service';
import { DocumentService } from './document.service';
import { DocumentWorkflowService } from './document-workflow.service';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import { NotificationService } from './notification.service';
import { formatUserError } from '../utils/user-errors';
import { formatCreatorDisplayName, formatRussianDateTime } from '../utils/formatters';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';
import { monthlyVideoReminderKeyboard } from '../keyboards/inline.keyboards';

export class AdminBulkOperationsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly creatorDisciplineService: CreatorDisciplineService,
    private readonly documentStatusService: DocumentStatusService,
    private readonly documentService: DocumentService,
    private readonly documentWorkflowService: DocumentWorkflowService,
    private readonly notificationService: NotificationService,
    private readonly googleSheetsSyncService: GoogleSheetsSyncService
  ) {}

  async remindMissingWeeklyStats(telegram: Telegram): Promise<BulkOperationResult> {
    const creators = await this.userRepository.listActiveCreators();
    const missing = await this.creatorDisciplineService.getWeeklyAttentionForCreators(creators);

    return this.sendNotifications(
      'remind-missing-weekly-stats',
      missing.map((item) => ({
        userId: item.creatorUserId,
        chatId: creators.find((creator) => creator.id === item.creatorUserId)?.telegramId,
        detail: `${item.creatorName} (${item.weekStart} - ${item.weekEnd})`,
        text: `Напоминание: не забудь заполнить и отправить недельную статистику за период ${item.weekStart} - ${item.weekEnd}.`
      })),
      telegram
    );
  }

  async remindMissingMonthlyVideos(telegram: Telegram, monthKey: string): Promise<BulkOperationResult> {
    const creators = await this.userRepository.listActiveCreators();
    const missing = await this.creatorDisciplineService.getMonthlyVideoStatuses(creators, monthKey);

    return this.sendNotifications(
      'remind-missing-monthly-videos',
      missing
        .filter((item) => item.status === 'MISSING')
        .map((item) => ({
          userId: item.creatorUserId,
          chatId: creators.find((creator) => creator.id === item.creatorUserId)?.telegramId,
          detail: `${item.creatorName} (${monthKey})`,
          text: [
            `Напоминание: ты не указал количество видео за ${monthKey}.`,
            'Нажми кнопку ниже и отправь число видео.'
          ].join('\n'),
          extra: monthlyVideoReminderKeyboard(monthKey)
        })),
      telegram
    );
  }

  async remindMissingDocuments(telegram: Telegram, monthKey: string): Promise<BulkOperationResult> {
    const creators = (await this.userRepository.listActiveCreators()).filter(
      (creator) => !isNoContractCreatorProfile(creator.creatorProfile)
    );
    const missing = await this.documentStatusService.listCreatorsWithMissingSignedDocuments(creators, monthKey);

    return this.sendNotifications(
      'remind-missing-documents',
      missing.map((item) => ({
        userId: item.creatorUserId,
        chatId: creators.find((creator) => creator.id === item.creatorUserId)?.telegramId,
        detail: `${item.creatorName} (${monthKey})`,
        text: `Напоминание: в системе еще нет полного пакета подписанных документов за ${monthKey}. Проверь раздел "Мои документы" и отправь подписанные PDF.`
      })),
      telegram
    );
  }

  async generateMonthlyDocumentsForAll(telegram: Telegram, monthKey: string): Promise<BulkOperationResult> {
    const creators = (await this.userRepository.listActiveCreators()).filter(
      (creator) => !isNoContractCreatorProfile(creator.creatorProfile)
    );

    return this.runBulkOperation(
      'generate-monthly-assignments',
      creators.map((creator) => ({
        detail: creator.creatorProfile?.fullName ?? creator.telegramId,
        execute: async () => {
          await this.documentService.generateMonthlyDocuments(creator.id, monthKey, telegram);
        }
      }))
    );
  }

  async generateActiveRosterFirstQueueForAll(telegram: Telegram): Promise<BulkOperationResult> {
    const creators = (await this.userRepository.listActiveCreators()).filter(
      (creator) => !isNoContractCreatorProfile(creator.creatorProfile)
    );

    return this.runBulkOperation(
      'generate-active-roster-first-queue',
      creators.map((creator) => ({
        detail: creator.creatorProfile?.fullName ?? creator.telegramId,
        execute: async () => {
          await this.documentService.generateActiveRosterResigningFirstQueueDocuments(creator.id, telegram);
        }
      }))
    );
  }

  async generateActiveRosterSecondQueueForAll(telegram: Telegram): Promise<BulkOperationResult> {
    const creators = (await this.userRepository.listActiveCreators()).filter(
      (creator) => !isNoContractCreatorProfile(creator.creatorProfile)
    );

    return this.runBulkOperation(
      'generate-active-roster-second-queue',
      creators.map((creator) => ({
        detail: creator.creatorProfile?.fullName ?? creator.telegramId,
        execute: async () => {
          await this.documentService.generateActiveRosterResigningSecondQueueDocuments(creator.id, telegram);
        }
      }))
    );
  }

  async markAwaitingReceiptsForMonth(monthKey: string): Promise<BulkOperationResult> {
    const creators = await this.userRepository.listActiveCreators();
    const details: string[] = [];
    const startedAt = new Date();
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const creator of creators) {
      const creatorName = formatCreatorDisplayName(creator, creator.telegramId);

      try {
        const result = await this.documentWorkflowService.markReceiptExpectedForMonth(
          creator.id,
          monthKey,
          startedAt
        );

        if (result.status === 'WAITING') {
          success += 1;
          details.push(
            `OK: ${creatorName} (${monthKey}) - ждем чек до ${formatRussianDateTime(result.receiptReminderDueAt)}`
          );
          continue;
        }

        skipped += 1;

        if (result.status === 'ALREADY_WAITING') {
          details.push(
            `SKIP: ${creatorName} (${monthKey}) - уже ждем чек до ${formatRussianDateTime(
              result.receiptReminderDueAt
            )}`
          );
        } else if (result.status === 'RECEIPT_UPLOADED') {
          details.push(
            `SKIP: ${creatorName} (${monthKey}) - чек уже загружен${
              result.receiptUploadedAt ? ` ${formatRussianDateTime(result.receiptUploadedAt)}` : ''
            }`
          );
        } else if (result.status === 'REMINDER_ALREADY_SENT') {
          details.push(
            `SKIP: ${creatorName} (${monthKey}) - напоминание уже отправлено ${formatRussianDateTime(
              result.receiptReminderSentAt
            )}`
          );
        } else if (result.status === 'NO_INVOICE') {
          details.push(`SKIP: ${creatorName} (${monthKey}) - счет за период еще не загружен`);
        } else {
          details.push(`SKIP: ${creatorName} (${monthKey}) - документооборот еще не подготовлен`);
        }
      } catch (error) {
        failed += 1;
        const message = formatUserError(error, 'не удалось поставить ожидание чека');
        details.push(`FAIL: ${creatorName} (${monthKey}) - ${message}`);
        logger.error({ error, monthKey, creatorUserId: creator.id }, 'Awaiting receipts bulk item failed');
      }
    }

    const result = {
      operation: 'await-receipts',
      total: creators.length,
      success,
      failed,
      skipped,
      details
    };

    logger.info({ result, monthKey }, 'Awaiting receipts bulk operation finished');

    return result;
  }

  async syncPaymentsForMonth(monthKey: string): Promise<BulkOperationResult> {
    const result = await this.googleSheetsSyncService.syncPayments({ monthKey });

    return {
      operation: 'sync-payments-for-month',
      total: result.totalRows,
      success: result.inserted + result.updated,
      failed: 0,
      skipped: 0,
      details: [
        `Лист: ${result.sheetName}`,
        `Добавлено строк: ${result.inserted}`,
        `Обновлено строк: ${result.updated}`
      ]
    };
  }

  async syncDocumentsForAll(monthKey?: string): Promise<BulkOperationResult> {
    const result = await this.googleSheetsSyncService.syncDocuments(monthKey ? { monthKey } : {});

    return {
      operation: 'sync-documents-for-all',
      total: result.totalRows,
      success: result.inserted + result.updated,
      failed: 0,
      skipped: 0,
      details: [
        `Лист: ${result.sheetName}`,
        `Добавлено строк: ${result.inserted}`,
        `Обновлено строк: ${result.updated}`
      ]
    };
  }

  private async sendNotifications(
    operation: string,
    items: Array<{
      userId: string;
      chatId?: string;
      detail: string;
      text: string;
      extra?: Parameters<Telegram['sendMessage']>[2];
    }>,
    telegram: Telegram
  ): Promise<BulkOperationResult> {
    return this.runBulkOperation(
      operation,
      items.map((item) => ({
        detail: item.detail,
        execute: async () => {
          if (!item.chatId) {
            throw new Error('Не найден chatId для отправки уведомления');
          }

          await this.notificationService.sendText(
            telegram,
            item.userId,
            item.chatId,
            item.text,
            {
              operation,
              detail: item.detail
            },
            item.extra
          );
        }
      }))
    );
  }

  private async runBulkOperation(
    operation: string,
    items: Array<{
      detail: string;
      execute: () => Promise<void>;
    }>
  ): Promise<BulkOperationResult> {
    const details: string[] = [];
    let success = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await item.execute();
        success += 1;
        details.push(`OK: ${item.detail}`);
      } catch (error) {
        failed += 1;
        const message = formatUserError(error, 'не удалось выполнить действие');
        details.push(`FAIL: ${item.detail} - ${message}`);
        logger.error({ error, operation, detail: item.detail }, 'Bulk operation item failed');
      }
    }

    const result = {
      operation,
      total: items.length,
      success,
      failed,
      skipped: 0,
      details
    };

    logger.info({ result }, 'Bulk operation finished');

    return result;
  }
}
