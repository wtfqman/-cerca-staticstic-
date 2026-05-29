import { DocumentType, DocumentWorkflowQueue } from '@prisma/client';

import { formatMonthLabelRu } from '../utils/formatters';
import { getCurrentMonthKey, getMonthRange, toDateOnly } from '../utils/periods';

const ACTIVE_ROSTER_RESIGNING_CAMPAIGN_PREFIX = 'active_roster_resigning';
const NO_CONTRACT_PAYMENT_CAMPAIGN_PREFIX = 'no_contract_payment';

const formatCampaignMonthSuffix = (monthKey: string) => monthKey.replace('-', '_');

export const getDocumentWorkflowMonthKey = () => getCurrentMonthKey();

export const getActiveRosterContractDate = (monthKey = getDocumentWorkflowMonthKey()) =>
  toDateOnly(getMonthRange(monthKey).dateFrom);

export const getActiveRosterResigningCampaignKey = (monthKey = getDocumentWorkflowMonthKey()) =>
  `${ACTIVE_ROSTER_RESIGNING_CAMPAIGN_PREFIX}_${formatCampaignMonthSuffix(monthKey)}`;

export const getActiveRosterResigningTitle = (monthKey = getDocumentWorkflowMonthKey()) =>
  `Переподписание действующего состава: ${formatMonthLabelRu(monthKey)}`;

export const getActiveRosterResigningPeriodMonths = (monthKey = getDocumentWorkflowMonthKey()) => [monthKey];

export const getNoContractPaymentCampaignKey = (monthKey = getDocumentWorkflowMonthKey()) =>
  `${NO_CONTRACT_PAYMENT_CAMPAIGN_PREFIX}_${formatCampaignMonthSuffix(monthKey)}`;

export const getNoContractPaymentTitle = (monthKey = getDocumentWorkflowMonthKey()) =>
  `Без договора: выплаты за ${formatMonthLabelRu(monthKey)}`;

export const getNoContractPaymentPeriodMonths = (monthKey = getDocumentWorkflowMonthKey()) => [monthKey];

export const getCreatorInvoiceMonthKey = () => getDocumentWorkflowMonthKey();

export const RECEIPT_REMINDER_DELAY_HOURS = 36;

export const FIRST_QUEUE_DOCUMENT_TYPES = [
  DocumentType.CONTRACT,
  DocumentType.NDA,
  DocumentType.ASSIGNMENT
] as const;

export const SECOND_QUEUE_DOCUMENT_TYPES = [
  DocumentType.ACT,
  DocumentType.RIGHTS_TRANSFER
] as const;

export const getDefaultDocumentWorkflowQueue = (type: DocumentType) => {
  if ((FIRST_QUEUE_DOCUMENT_TYPES as readonly DocumentType[]).includes(type)) {
    return DocumentWorkflowQueue.FIRST_QUEUE;
  }

  if ((SECOND_QUEUE_DOCUMENT_TYPES as readonly DocumentType[]).includes(type)) {
    return DocumentWorkflowQueue.SECOND_QUEUE;
  }

  return null;
};

export const normalizeCampaignPeriodMonths = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && /^\d{4}-\d{2}$/.test(item));
};

export const isActiveRosterResigningCampaignKey = (key?: string | null) =>
  Boolean(key?.startsWith(`${ACTIVE_ROSTER_RESIGNING_CAMPAIGN_PREFIX}_`));

export const isActiveRosterResigningScopeKey = (scopeKey?: string | null) =>
  Boolean(scopeKey?.startsWith(`${ACTIVE_ROSTER_RESIGNING_CAMPAIGN_PREFIX}_`));

export const isCurrentActiveRosterResigningScopeKey = (
  scopeKey?: string | null,
  monthKey = getDocumentWorkflowMonthKey()
) => {
  const campaignKey = getActiveRosterResigningCampaignKey(monthKey);

  return Boolean(scopeKey === campaignKey || scopeKey?.startsWith(`${campaignKey}:`));
};

export const isCurrentDocumentWorkflowScopeKey = (scopeKey?: string | null) =>
  !isActiveRosterResigningScopeKey(scopeKey) || isCurrentActiveRosterResigningScopeKey(scopeKey);

export const isCreatorInvoiceMonth = (monthKey: string) => monthKey === getCreatorInvoiceMonthKey();

export const filterCreatorInvoiceMonths = (monthKeys: string[]) =>
  monthKeys.filter(isCreatorInvoiceMonth);

export const addReceiptReminderDelay = (date: Date) =>
  new Date(date.getTime() + RECEIPT_REMINDER_DELAY_HOURS * 60 * 60 * 1000);

export const getWorkflowDocumentScopeKey = (params: {
  campaignKey: string;
  type: DocumentType;
  monthKey?: string;
}) =>
  [params.campaignKey, params.type, params.monthKey]
    .filter(Boolean)
    .join(':');
