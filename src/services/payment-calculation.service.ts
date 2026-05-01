import type { PaymentCalculationSummary } from '../types/report.types';
import { roundViewsToStep } from '../utils/rounding';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentSnapshotRepository } from '../repositories/payment-snapshot.repository';

const FIXED_RATE_PER_VIDEO = 730;
const FIXED_SALARY_CAP = 35_040;

interface PaymentCalculationOptions {
  submittedOnly?: boolean;
  persistSnapshot?: boolean;
}

export class PaymentCalculationService {
  constructor(
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentSnapshotRepository: PaymentSnapshotRepository
  ) {}

  async calculateForCreatorMonth(
    creatorUserId: string,
    monthKey: string,
    options: PaymentCalculationOptions = {}
  ): Promise<PaymentCalculationSummary> {
    const aggregation = await this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey, {
      submittedOnly: options.submittedOnly
    });
    const summary = this.calculateFromAggregation(creatorUserId, monthKey, aggregation);

    if (options.persistSnapshot !== false) {
      await this.paymentSnapshotRepository.upsert(creatorUserId, monthKey, {
        rawViews: summary.rawViews,
        roundedViews: summary.roundedViews,
        appliedRate: summary.appliedRate,
        viewSteps: summary.viewSteps,
        actualVideoCount: summary.actualVideoCount,
        fixedSalaryPart: summary.fixedSalaryPart,
        variablePart: summary.variablePart,
        totalPayment: summary.totalPayment,
        payloadJson: summary
      });
    }

    return summary;
  }

  calculateFromAggregation(
    creatorUserId: string,
    monthKey: string,
    aggregation: Awaited<ReturnType<MonthlyAggregationService['aggregateCreatorMonth']>>
  ): PaymentCalculationSummary {
    const actualVideoCount = aggregation.monthlyVideoSubmitted
      ? aggregation.monthlyVideoCount
      : aggregation.totals.videoCount;
    const fixedSalaryPart = Math.min(actualVideoCount * FIXED_RATE_PER_VIDEO, FIXED_SALARY_CAP);

    const rounding = roundViewsToStep(aggregation.totals.views);
    const viewSteps = rounding.roundedViews / rounding.step;
    const appliedRate = this.resolveRate(rounding.roundedViews);
    const variablePart = viewSteps * appliedRate;
    const totalPayment = fixedSalaryPart + variablePart;

    return {
      monthKey,
      creatorUserId,
      targetVideoCount: Math.ceil(FIXED_SALARY_CAP / FIXED_RATE_PER_VIDEO),
      baseSalary: FIXED_SALARY_CAP,
      fixedRatePerVideo: FIXED_RATE_PER_VIDEO,
      fixedSalaryCap: FIXED_SALARY_CAP,
      actualVideoCount,
      fixedSalaryPart,
      rawViews: rounding.rawViews,
      roundedViews: rounding.roundedViews,
      roundingApplied: rounding.roundingApplied,
      roundingReason: rounding.roundingReason,
      step: rounding.step,
      upThreshold: rounding.upThreshold,
      viewSteps,
      appliedRate,
      variablePart,
      totalPayment,
      platformBreakdown: aggregation.platformBreakdown,
      generatedAt: new Date().toISOString()
    };
  }

  private resolveRate(roundedViews: number) {
    if (roundedViews >= 5_000_000) {
      return 8_000;
    }

    if (roundedViews >= 3_000_000) {
      return 5_000;
    }

    return 3_000;
  }
}
