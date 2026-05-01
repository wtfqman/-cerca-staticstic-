import {
  ACTIVE_ROSTER_CONTRACT_DATE,
  ACTIVE_ROSTER_RESIGNING_CAMPAIGN_KEY,
  ACTIVE_ROSTER_RESIGNING_PERIOD_MONTHS,
  normalizeCampaignPeriodMonths
} from '../documents/document-workflow.constants';

type StatisticsScenarioUser = {
  documentWorkflowStates?: Array<{
    campaign?: {
      key?: string | null;
      contractDate?: Date | string | null;
      periodMonths?: unknown;
    } | null;
  }> | null;
};

const dateKey = (value?: Date | string | null) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export const isMarchAprilStatisticsScenario = (user?: StatisticsScenarioUser | null) =>
  Boolean(
    user?.documentWorkflowStates?.some((state) => {
      const campaign = state.campaign;
      const periodMonths = normalizeCampaignPeriodMonths(campaign?.periodMonths);

      return (
        campaign?.key === ACTIVE_ROSTER_RESIGNING_CAMPAIGN_KEY &&
        dateKey(campaign.contractDate) === dateKey(ACTIVE_ROSTER_CONTRACT_DATE) &&
        ACTIVE_ROSTER_RESIGNING_PERIOD_MONTHS.every((monthKey) => periodMonths.includes(monthKey))
      );
    })
  );
