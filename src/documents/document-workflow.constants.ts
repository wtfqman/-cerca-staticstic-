import { DocumentType, DocumentWorkflowQueue } from '@prisma/client';

export const ACTIVE_ROSTER_RESIGNING_CAMPAIGN_KEY = 'active_roster_resigning_2026_march';
export const ACTIVE_ROSTER_RESIGNING_TITLE = 'Переподписание действующего состава: март 2026';
export const ACTIVE_ROSTER_RESIGNING_PERIOD_MONTHS = ['2026-03', '2026-04'] as const;
export const NO_CONTRACT_PAYMENT_CAMPAIGN_KEY = 'no_contract_payment_2026_april';
export const NO_CONTRACT_PAYMENT_TITLE = 'Без договора: выплаты за апрель 2026';
export const NO_CONTRACT_PAYMENT_PERIOD_MONTHS = ['2026-04'] as const;
export const CREATOR_INVOICE_MONTH_KEY = '2026-04';
export const CREATOR_INVOICE_MONTHS = [CREATOR_INVOICE_MONTH_KEY] as const;

export const ACTIVE_ROSTER_CONTRACT_DATE = new Date(Date.UTC(2026, 2, 1));
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

export const isCreatorInvoiceMonth = (monthKey: string) =>
  (CREATOR_INVOICE_MONTHS as readonly string[]).includes(monthKey);

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
