export interface RoundViewsOptions {
  step?: number;
  upThreshold?: number;
}

export interface RoundViewsResult {
  rawViews: number;
  roundedViews: number;
  roundingApplied: boolean;
  roundingReason: string;
  step: number;
  upThreshold: number;
}

export const roundViewsToStep = (
  rawViews: number,
  options: RoundViewsOptions = {}
): RoundViewsResult => {
  const step = options.step ?? 500_000;
  const upThreshold = options.upThreshold ?? 50_000;

  if (!Number.isInteger(rawViews) || rawViews < 0) {
    throw new Error('rawViews must be a non-negative integer');
  }

  const remainder = rawViews % step;
  const lower = rawViews - remainder;

  if (remainder === 0) {
    return {
      rawViews,
      roundedViews: rawViews,
      roundingApplied: false,
      roundingReason: 'already_on_step',
      step,
      upThreshold
    };
  }

  const distanceToNextStep = step - remainder;
  const roundUp = distanceToNextStep <= upThreshold;
  const roundedViews = roundUp ? lower + step : lower;

  return {
    rawViews,
    roundedViews,
    roundingApplied: roundedViews !== rawViews,
    roundingReason: roundUp ? 'rounded_up_by_threshold' : 'rounded_down_to_previous_step',
    step,
    upThreshold
  };
};
