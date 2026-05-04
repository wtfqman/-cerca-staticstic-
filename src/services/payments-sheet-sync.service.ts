import type { AppUser } from '../types/domain';
import { MonthlyVideoRepository } from '../repositories/monthly-video.repository';
import { UserRepository } from '../repositories/user.repository';
import { WeeklyStatsRepository } from '../repositories/weekly-stats.repository';
import { formatAssignedTeamLeadName, formatCreatorDisplayName, formatRussianDateTime } from '../utils/formatters';
import { mapInBatches } from '../utils/batch';
import { PaymentCalculationService } from './payment-calculation.service';
import { GoogleSheetsService, type SheetRow, type SheetUpsertResult } from './google-sheets.service';
import { SpreadsheetFormatterService } from './spreadsheet-formatter.service';
import { isCreatorInvoiceMonth } from '../documents/document-workflow.constants';
import { getCreatorInvoiceDisplayAmount } from '../payments/payment.constants';

interface CreatorMonthPair {
  creatorUserId: string;
  monthKey: string;
}

const deduplicatePairs = (pairs: CreatorMonthPair[]) => {
  const map = new Map<string, CreatorMonthPair>();

  for (const pair of pairs) {
    map.set(`${pair.creatorUserId}:${pair.monthKey}`, pair);
  }

  return Array.from(map.values()).sort((left, right) =>
    `${left.monthKey}:${left.creatorUserId}`.localeCompare(`${right.monthKey}:${right.creatorUserId}`)
  );
};

const sortPaymentRows = (rows: SheetRow[]) =>
  [...rows].sort((left, right) => {
    const creatorCompare = String(left.values[2] ?? '').localeCompare(String(right.values[2] ?? ''), 'ru');

    if (creatorCompare !== 0) {
      return creatorCompare;
    }

    return String(left.values[4] ?? '').localeCompare(String(right.values[4] ?? ''));
  });

export class PaymentsSheetSyncService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly weeklyStatsRepository: WeeklyStatsRepository,
    private readonly monthlyVideoRepository: MonthlyVideoRepository,
    private readonly paymentCalculationService: PaymentCalculationService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly formatter: SpreadsheetFormatterService
  ) {}

  async prepareSheet() {
    await this.googleSheetsService.ensureSheet(this.formatter.getPaymentsSheetDefinition());
  }

  async syncCreatorMonth(creatorUserId: string, monthKey: string): Promise<SheetUpsertResult> {
    const creator = await this.userRepository.findById(creatorUserId);

    if (!creator) {
      throw new Error('Креатор для синхронизации выплат не найден');
    }

    const definition = this.formatter.getPaymentsSheetDefinition();
    const row = await this.buildRow({ creatorUserId, monthKey }, creator);

    return this.googleSheetsService.upsertRows(definition, row ? [row] : []);
  }

  async syncMonth(monthKey: string, creatorIds?: string[]): Promise<SheetUpsertResult> {
    const creators = creatorIds?.length
      ? await this.userRepository.listByIds(creatorIds)
      : await this.userRepository.listActiveCreators();
    const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
    const rows = await this.buildRows(
      creators.map((creator) => ({
        creatorUserId: creator.id,
        monthKey
      })),
      creatorMap
    );

    return this.googleSheetsService.upsertRows(this.formatter.getPaymentsSheetDefinition(), rows);
  }

  async syncAll(): Promise<SheetUpsertResult> {
    const pairs = await this.collectAllCreatorMonthPairs();
    const creators = await this.userRepository.listByIds([...new Set(pairs.map((pair) => pair.creatorUserId))]);
    const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
    const rows = await this.buildRows(pairs, creatorMap);

    return this.googleSheetsService.upsertRows(this.formatter.getPaymentsSheetDefinition(), rows);
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const pairs = await this.collectAllCreatorMonthPairs();
    const creators = await this.userRepository.listByIds([...new Set(pairs.map((pair) => pair.creatorUserId))]);
    const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
    const rows = await this.buildRows(pairs, creatorMap);

    return this.googleSheetsService.rebuildSheet(this.formatter.getPaymentsSheetDefinition(), rows);
  }

  private async collectAllCreatorMonthPairs() {
    const [weeklyPairs, monthlyPairs] = await Promise.all([
      this.weeklyStatsRepository.listCreatorMonthsWithData(),
      this.monthlyVideoRepository.listCreatorMonthsWithData()
    ]);

    return deduplicatePairs([...weeklyPairs, ...monthlyPairs]);
  }

  private async buildRows(pairs: CreatorMonthPair[], creatorMap: Map<string, AppUser>) {
    const rows = await mapInBatches(deduplicatePairs(pairs), 10, async (pair) => {
      const creator = creatorMap.get(pair.creatorUserId);
      return creator ? this.buildRow(pair, creator) : null;
    });

    return sortPaymentRows(rows.filter((row): row is NonNullable<typeof row> => Boolean(row)));
  }

  private async buildRow(pair: CreatorMonthPair, creator: AppUser) {
    const payment = await this.paymentCalculationService.calculateForCreatorMonth(
      pair.creatorUserId,
      pair.monthKey
    );

    const totalPayment = isCreatorInvoiceMonth(pair.monthKey)
      ? getCreatorInvoiceDisplayAmount(payment.totalPayment)
      : payment.totalPayment;

    return this.formatter.buildPaymentsRow({
      creatorUserId: pair.creatorUserId,
      creatorName: formatCreatorDisplayName(creator),
      teamLeadName: formatAssignedTeamLeadName(creator),
      monthKey: pair.monthKey,
      actualVideoCount: payment.actualVideoCount,
      fixedSalaryPart: payment.fixedSalaryPart,
      rawViews: payment.rawViews,
      roundedViews: payment.roundedViews,
      appliedRate: payment.appliedRate,
      viewSteps: payment.viewSteps,
      variablePart: payment.variablePart,
      totalPayment,
      calculationUpdatedAt: formatRussianDateTime(payment.generatedAt)
    });
  }
}
