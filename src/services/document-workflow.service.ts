import {
  CreatorDocumentWorkflowStatus,
  DocumentStatus,
  DocumentType,
  DocumentWorkflowCampaignStatus,
  DocumentWorkflowCampaignType,
  DocumentWorkflowQueue,
  PaymentDocumentStatus,
  PaymentDocumentType,
  type Document,
  type PaymentDocumentUpload
} from '@prisma/client';

import {
  SECOND_QUEUE_DOCUMENT_TYPES,
  addReceiptReminderDelay,
  getActiveRosterContractDate,
  getActiveRosterResigningCampaignKey,
  getActiveRosterResigningPeriodMonths,
  getActiveRosterResigningTitle,
  getDefaultDocumentWorkflowQueue,
  getCreatorInvoiceMonthKey,
  getNoContractPaymentCampaignKey,
  getNoContractPaymentPeriodMonths,
  getNoContractPaymentTitle,
  isCreatorInvoiceMonth,
  normalizeCampaignPeriodMonths
} from '../documents/document-workflow.constants';
import {
  PERMANENT_SIGNATURE_DOCUMENT_TYPES,
  isPermanentSignatureDocumentType
} from '../documents/document-reuse.helpers';
import { logger } from '../lib/logger';
import { DocumentRepository } from '../repositories/document.repository';
import { isApprovedTemplateDocumentPayload } from './document.service';
import {
  DocumentWorkflowRepository,
  type DocumentWorkflowStateWithRelations
} from '../repositories/document-workflow.repository';

const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

const isCurrentTemplateDocument = (document: Pick<Document, 'payloadJson' | 'type'>) =>
  isApprovedTemplateDocumentPayload(document.payloadJson, document.type);

const isSignedDocument = (document: Pick<Document, 'status'>) =>
  SIGNED_DOCUMENT_STATUSES.has(document.status);

const isUsableWorkflowDocument = (document: Pick<Document, 'status' | 'payloadJson' | 'type'>) =>
  isSignedDocument(document) ||
  isCurrentTemplateDocument(document) ||
  (isPermanentSignatureDocumentType(document.type) && document.status !== DocumentStatus.FAILED);

const getWorkflowDocumentRank = (document: Pick<Document, 'status' | 'payloadJson' | 'type'>) => {
  if (isSignedDocument(document)) {
    return 30;
  }

  if (isPermanentSignatureDocumentType(document.type) && document.status !== DocumentStatus.FAILED) {
    return 20;
  }

  if (isCurrentTemplateDocument(document)) {
    return 10;
  }

  return 0;
};

const getWorkflowDocumentTimestamp = (
  document: Pick<Document, 'generatedAt' | 'sentAt' | 'signedUploadedAt' | 'forwardedAt'>
) =>
  document.forwardedAt?.getTime() ??
  document.signedUploadedAt?.getTime() ??
  document.sentAt?.getTime() ??
  document.generatedAt.getTime();

const pickBestWorkflowDocument = <T extends Pick<
  Document,
  'status' | 'payloadJson' | 'type' | 'generatedAt' | 'sentAt' | 'signedUploadedAt' | 'forwardedAt'
>>(documents: T[]) =>
  [...documents]
    .filter(isUsableWorkflowDocument)
    .sort((left, right) => {
      const rankDiff = getWorkflowDocumentRank(right) - getWorkflowDocumentRank(left);

      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (
        left.type === right.type &&
        isPermanentSignatureDocumentType(left.type) &&
        !isSignedDocument(left) &&
        !isSignedDocument(right)
      ) {
        return getWorkflowDocumentTimestamp(left) - getWorkflowDocumentTimestamp(right);
      }

      return getWorkflowDocumentTimestamp(right) - getWorkflowDocumentTimestamp(left);
    })[0] ?? null;

const hasRequiredSignedWorkflowDocument = (
  state: DocumentWorkflowStateWithRelations,
  queue: DocumentWorkflowQueue,
  type: DocumentType,
  monthKey: string | null
) =>
  state.documents.some(
    (link) =>
      link.required &&
      link.queue === queue &&
      link.document.type === type &&
      (link.document.monthKey ?? null) === monthKey &&
      isSignedDocument(link.document)
  );

const isFirstQueueSigned = (state: DocumentWorkflowStateWithRelations) =>
  PERMANENT_SIGNATURE_DOCUMENT_TYPES.every((type) =>
    hasRequiredSignedWorkflowDocument(state, DocumentWorkflowQueue.FIRST_QUEUE, type, null)
  );

const isSecondQueueSignedForMonth = (state: DocumentWorkflowStateWithRelations, monthKey: string) =>
  SECOND_QUEUE_DOCUMENT_TYPES.every((type) =>
    hasRequiredSignedWorkflowDocument(state, DocumentWorkflowQueue.SECOND_QUEUE, type, monthKey)
  );

const getMissingSecondQueueSignedDocumentTypes = (
  state: DocumentWorkflowStateWithRelations,
  monthKey: string
) =>
  SECOND_QUEUE_DOCUMENT_TYPES.filter(
    (type) => !hasRequiredSignedWorkflowDocument(state, DocumentWorkflowQueue.SECOND_QUEUE, type, monthKey)
  );

const isSecondQueueSignedForAllPeriodMonths = (state: DocumentWorkflowStateWithRelations) => {
  const periodMonths = normalizeCampaignPeriodMonths(state.campaign.periodMonths);

  return periodMonths.length > 0 && periodMonths.every((monthKey) => isSecondQueueSignedForMonth(state, monthKey));
};

const formatSecondQueueDocumentTypes = (types: readonly DocumentType[] = SECOND_QUEUE_DOCUMENT_TYPES) => {
  const labels = types.map((type) => {
    switch (type) {
      case DocumentType.ASSIGNMENT:
        return 'задание';
      case DocumentType.ACT:
        return 'акт';
      default:
        return 'документ';
    }
  });

  return labels.join(' и ');
};

const buildSecondQueueRequiredMessage = (
  monthKey?: string,
  missingTypes?: readonly DocumentType[]
) => {
  const documentsLabel = formatSecondQueueDocumentTypes(
    missingTypes && missingTypes.length > 0 ? missingTypes : SECOND_QUEUE_DOCUMENT_TYPES
  );

  return monthKey
    ? `Сначала нужно загрузить подписанные документы второй очереди за ${monthKey}: ${documentsLabel}.`
    : `Сначала нужно загрузить подписанные документы второй очереди: ${documentsLabel}.`;
};

const isActivePaymentUpload = (upload: Pick<PaymentDocumentUpload, 'status'>) =>
  upload.status !== PaymentDocumentStatus.REJECTED;

const isNoContractPaymentState = (state: DocumentWorkflowStateWithRelations) =>
  state.campaign.key === getNoContractPaymentCampaignKey() &&
  state.creator.creatorProfile?.profileCompleted === true &&
  state.creator.creatorProfile.legalType === null;

const isSamePaymentPeriod = (left?: string | null, right?: string | null) => (left ?? null) === (right ?? null);

const getLatestPaymentUpload = (
  state: DocumentWorkflowStateWithRelations,
  type: PaymentDocumentType,
  monthKey?: string
) =>
  state.paymentUploads.find(
    (upload) =>
      upload.type === type &&
      isActivePaymentUpload(upload) &&
      (monthKey === undefined || isSamePaymentPeriod(upload.monthKey, monthKey))
  );

const getReceiptForInvoice = (
  state: DocumentWorkflowStateWithRelations,
  invoiceUpload: Pick<PaymentDocumentUpload, 'monthKey' | 'uploadedAt'>
) =>
  state.paymentUploads.find(
    (upload) =>
      upload.type === PaymentDocumentType.RECEIPT &&
      isActivePaymentUpload(upload) &&
      isSamePaymentPeriod(upload.monthKey, invoiceUpload.monthKey) &&
      upload.uploadedAt >= invoiceUpload.uploadedAt
  );

const getReceiptExpectedAtForInvoice = (
  state: DocumentWorkflowStateWithRelations,
  invoiceUpload: PaymentDocumentUpload
) => {
  if (invoiceUpload.receiptExpectedAt) {
    return invoiceUpload.receiptExpectedAt;
  }

  if (state.receiptExpectedAt?.getTime() === invoiceUpload.uploadedAt.getTime()) {
    return state.receiptExpectedAt;
  }

  return null;
};

const getReceiptReminderDueAtForInvoice = (
  state: DocumentWorkflowStateWithRelations,
  invoiceUpload: PaymentDocumentUpload
) => {
  const expectedAt = getReceiptExpectedAtForInvoice(state, invoiceUpload);

  if (!expectedAt) {
    return null;
  }

  const stateMatchesInvoice = state.receiptExpectedAt?.getTime() === invoiceUpload.uploadedAt.getTime();

  return invoiceUpload.receiptReminderDueAt ??
    (stateMatchesInvoice ? state.receiptReminderDueAt : null) ??
    addReceiptReminderDelay(expectedAt);
};

const getReceiptReminderSentAtForInvoice = (
  state: DocumentWorkflowStateWithRelations,
  invoiceUpload: PaymentDocumentUpload
) => {
  if (invoiceUpload.receiptReminderSentAt) {
    return invoiceUpload.receiptReminderSentAt;
  }

  if (state.receiptExpectedAt?.getTime() === invoiceUpload.uploadedAt.getTime()) {
    return state.receiptReminderSentAt;
  }

  return null;
};

const getPaymentQueueStatus = (
  state: DocumentWorkflowStateWithRelations | null | undefined,
  monthKey: string
) => {
  const invoiceUpload = state
    ? getLatestPaymentUpload(state, PaymentDocumentType.INVOICE, monthKey)
    : undefined;
  const receiptForInvoice = state && invoiceUpload
    ? getReceiptForInvoice(state, invoiceUpload)
    : undefined;
  const receiptExpectedAt = state && invoiceUpload && !receiptForInvoice
    ? getReceiptExpectedAtForInvoice(state, invoiceUpload)
    : null;
  const receiptReminderDueAt = state && invoiceUpload && !receiptForInvoice
    ? getReceiptReminderDueAtForInvoice(state, invoiceUpload)
    : null;
  const receiptReminderSentAt = state && invoiceUpload && !receiptForInvoice
    ? getReceiptReminderSentAtForInvoice(state, invoiceUpload)
    : null;

  return {
    invoiceUploadedAt: invoiceUpload?.uploadedAt ?? null,
    receiptExpectedAt,
    receiptReminderDueAt,
    receiptReminderSentAt,
    receiptUploadedAt: receiptForInvoice?.uploadedAt ?? null
  };
};

const getActTotalPaymentForMonth = (
  state: DocumentWorkflowStateWithRelations | null | undefined,
  monthKey: string
) => {
  const actDocument = state?.documents.find(
    (link) =>
      link.queue === DocumentWorkflowQueue.SECOND_QUEUE &&
      link.document.type === DocumentType.ACT &&
      link.document.monthKey === monthKey &&
      isCurrentTemplateDocument(link.document)
  )?.document;
  const payload = actDocument?.payloadJson as Record<string, unknown> | undefined;
  const payment = payload?.payment as Record<string, unknown> | undefined;

  return typeof payment?.totalPayment === 'number' ? payment.totalPayment : null;
};

const getPendingReceiptInvoice = (state: DocumentWorkflowStateWithRelations) => {
  const invoiceUploads = state.paymentUploads
    .filter(
      (upload) =>
        upload.type === PaymentDocumentType.INVOICE &&
        isActivePaymentUpload(upload) &&
        getReceiptExpectedAtForInvoice(state, upload)
    )
    .sort((left, right) => {
      const leftDueAt = getReceiptReminderDueAtForInvoice(state, left) ?? left.uploadedAt;
      const rightDueAt = getReceiptReminderDueAtForInvoice(state, right) ?? right.uploadedAt;

      return leftDueAt.getTime() - rightDueAt.getTime();
    });

  return invoiceUploads.find((invoiceUpload) => !getReceiptForInvoice(state, invoiceUpload));
};

export interface ActiveRosterFirstQueueDocumentStatus {
  type: DocumentType;
  monthKey: string | null;
  status: DocumentStatus | 'NOT_GENERATED';
  documentId?: string;
  generatedAt?: Date;
  sentAt?: Date | null;
  signedUploadedAt?: Date | null;
  forwardedAt?: Date | null;
  latestUploadName?: string | null;
}

export interface ActiveRosterFirstQueueSummary {
  campaignKey: string;
  campaignTitle: string;
  contractDate: Date;
  periodMonths: string[];
  isPrepared: boolean;
  isCompleted: boolean;
  completedAt?: Date | null;
  documents: ActiveRosterFirstQueueDocumentStatus[];
}

export interface ActiveRosterSecondQueueDocumentStatus {
  type: DocumentType;
  monthKey: string;
  status: DocumentStatus | 'NOT_GENERATED' | 'LOCKED';
  documentId?: string;
  generatedAt?: Date;
  sentAt?: Date | null;
  signedUploadedAt?: Date | null;
  forwardedAt?: Date | null;
  latestUploadName?: string | null;
  invoiceUploadedAt?: Date | null;
  receiptExpectedAt?: Date | null;
  receiptReminderDueAt?: Date | null;
  receiptReminderSentAt?: Date | null;
  receiptUploadedAt?: Date | null;
  totalPayment?: number | null;
  fixedSalaryPart?: number | null;
  variablePart?: number | null;
  actualVideoCount?: number | null;
  rawViews?: number | null;
}

export interface ActiveRosterPaymentQueueStatus {
  monthKey: string;
  secondQueueSigned: boolean;
  invoiceUploadedAt?: Date | null;
  receiptExpectedAt?: Date | null;
  receiptReminderDueAt?: Date | null;
  receiptReminderSentAt?: Date | null;
  receiptUploadedAt?: Date | null;
  totalPayment?: number | null;
}

export interface ActiveRosterSecondQueueSummary {
  campaignKey: string;
  campaignTitle: string;
  periodMonths: string[];
  isPrepared: boolean;
  isFirstQueueCompleted: boolean;
  isCompleted: boolean;
  lockedReason?: string;
  completedAt?: Date | null;
  documents: ActiveRosterSecondQueueDocumentStatus[];
  payments: ActiveRosterPaymentQueueStatus[];
}

export type ReceiptExpectationMarkResult =
  | { status: 'WAITING'; receiptExpectedAt: Date; receiptReminderDueAt: Date }
  | { status: 'ALREADY_WAITING'; receiptExpectedAt: Date; receiptReminderDueAt: Date }
  | { status: 'NO_WORKFLOW' }
  | { status: 'NO_INVOICE' }
  | { status: 'RECEIPT_UPLOADED'; receiptUploadedAt?: Date | null }
  | { status: 'REMINDER_ALREADY_SENT'; receiptReminderSentAt: Date };

export class DocumentWorkflowService {
  constructor(
    private readonly workflowRepository: DocumentWorkflowRepository,
    private readonly documentRepository: DocumentRepository
  ) {}

  async ensureActiveRosterResigningCampaign(createdByUserId?: string) {
    const monthKey = getCreatorInvoiceMonthKey();
    const campaignKey = getActiveRosterResigningCampaignKey(monthKey);
    const existingCampaign = await this.workflowRepository.findCampaignByKey(campaignKey);
    const contractDate = getActiveRosterContractDate(monthKey);

    return this.workflowRepository.upsertCampaign({
      key: campaignKey,
      type: DocumentWorkflowCampaignType.ACTIVE_ROSTER_RESIGNING,
      status: DocumentWorkflowCampaignStatus.ACTIVE,
      title: getActiveRosterResigningTitle(monthKey),
      description:
        'Управляемый сценарий переподписания действующего состава: договор и задание на актуальный месяц, акт на дату закрытия месяца.',
      contractDate,
      periodMonths: getActiveRosterResigningPeriodMonths(monthKey),
      createdByUserId: existingCampaign?.createdByUserId ?? createdByUserId,
      activatedAt: existingCampaign?.activatedAt ?? new Date()
    });
  }

  async prepareActiveRosterResigningWorkflow(creatorUserId: string, createdByUserId?: string) {
    const campaign = await this.ensureActiveRosterResigningCampaign(createdByUserId);
    const state = await this.workflowRepository.ensureState({
      campaignId: campaign.id,
      creatorUserId
    });

    await this.linkReusablePermanentFirstQueueDocuments(state.id, creatorUserId);

    return this.refreshWorkflowState(state.id);
  }

  private async linkReusablePermanentFirstQueueDocuments(workflowStateId: string, creatorUserId: string) {
    const reusableDocuments = await this.documentRepository.listOneOffByCreatorAndTypes(
      creatorUserId,
      [...PERMANENT_SIGNATURE_DOCUMENT_TYPES]
    );

    for (const type of PERMANENT_SIGNATURE_DOCUMENT_TYPES) {
      const reusableDocument = pickBestWorkflowDocument(
        reusableDocuments.filter((document) => document.type === type)
      );

      if (!reusableDocument) {
        continue;
      }

      await this.workflowRepository.linkDocument({
        workflowStateId,
        documentId: reusableDocument.id,
        queue: DocumentWorkflowQueue.FIRST_QUEUE,
        required: true
      });
    }
  }

  async ensureNoContractPaymentCampaign(createdByUserId?: string) {
    const monthKey = getCreatorInvoiceMonthKey();
    const campaignKey = getNoContractPaymentCampaignKey(monthKey);
    const existingCampaign = await this.workflowRepository.findCampaignByKey(campaignKey);

    return this.workflowRepository.upsertCampaign({
      key: campaignKey,
      type: DocumentWorkflowCampaignType.REGULAR,
      status: DocumentWorkflowCampaignStatus.ACTIVE,
      title: getNoContractPaymentTitle(monthKey),
      description: 'Сценарий без договора: статистика и загрузка счета без очередей документов.',
      periodMonths: getNoContractPaymentPeriodMonths(monthKey),
      createdByUserId: existingCampaign?.createdByUserId ?? createdByUserId,
      activatedAt: existingCampaign?.activatedAt ?? new Date()
    });
  }

  async prepareNoContractPaymentWorkflow(creatorUserId: string, createdByUserId?: string) {
    const campaign = await this.ensureNoContractPaymentCampaign(createdByUserId);
    const state = await this.workflowRepository.ensureState({
      campaignId: campaign.id,
      creatorUserId
    });

    return this.refreshWorkflowState(state.id);
  }

  async getActiveRosterFirstQueueSummary(creatorUserId: string): Promise<ActiveRosterFirstQueueSummary> {
    const campaignKey = getActiveRosterResigningCampaignKey();
    let campaign = await this.workflowRepository.findCampaignByKey(campaignKey);
    let state = campaign
      ? await this.workflowRepository.findState(campaign.id, creatorUserId)
      : null;

    if (!state) {
      const reusableDocuments = await this.documentRepository.listOneOffByCreatorAndTypes(
        creatorUserId,
        [...PERMANENT_SIGNATURE_DOCUMENT_TYPES]
      );

      if (PERMANENT_SIGNATURE_DOCUMENT_TYPES.some((type) =>
        pickBestWorkflowDocument(reusableDocuments.filter((document) => document.type === type))
      )) {
        const preparedState = await this.prepareActiveRosterResigningWorkflow(creatorUserId);

        campaign = preparedState.campaign;
        state = preparedState;
      }
    } else {
      await this.linkReusablePermanentFirstQueueDocuments(state.id, creatorUserId);
    }

    const refreshedState = state ? await this.refreshWorkflowState(state.id) : null;
    const periodMonths = normalizeCampaignPeriodMonths(
      refreshedState?.campaign.periodMonths ?? campaign?.periodMonths ?? getActiveRosterResigningPeriodMonths()
    );
    const expectedDocuments: Array<{ type: DocumentType; monthKey: string | null }> =
      PERMANENT_SIGNATURE_DOCUMENT_TYPES.map((type) => ({ type, monthKey: null }));

    return {
      campaignKey: refreshedState?.campaign.key ?? campaign?.key ?? campaignKey,
      campaignTitle: refreshedState?.campaign.title ?? campaign?.title ?? getActiveRosterResigningTitle(),
      contractDate: refreshedState?.campaign.contractDate ?? campaign?.contractDate ?? getActiveRosterContractDate(),
      periodMonths,
      isPrepared: Boolean(refreshedState),
      isCompleted: Boolean(refreshedState?.firstQueueCompletedAt),
      completedAt: refreshedState?.firstQueueCompletedAt,
      documents: expectedDocuments.map((expectedDocument) => {
        const linkedDocument = pickBestWorkflowDocument(
          refreshedState?.documents
            .filter(
              (link) =>
                link.queue === DocumentWorkflowQueue.FIRST_QUEUE &&
                link.document.type === expectedDocument.type &&
                (link.document.monthKey ?? null) === expectedDocument.monthKey
            )
            .map((link) => link.document) ?? []
        );

        if (!linkedDocument || !isUsableWorkflowDocument(linkedDocument)) {
          return {
            ...expectedDocument,
            status: 'NOT_GENERATED' as const
          };
        }

        return {
          ...expectedDocument,
          documentId: linkedDocument.id,
          status: linkedDocument.status,
          generatedAt: linkedDocument.generatedAt,
          sentAt: linkedDocument.sentAt,
          signedUploadedAt: linkedDocument.signedUploadedAt,
          forwardedAt: linkedDocument.forwardedAt,
          latestUploadName: linkedDocument.signatureUploads[0]?.originalFileName ?? null
        };
      })
    };
  }

  async getActiveRosterSecondQueueSummary(creatorUserId: string): Promise<ActiveRosterSecondQueueSummary> {
    const campaignKey = getActiveRosterResigningCampaignKey();
    const campaign = await this.workflowRepository.findCampaignByKey(campaignKey);
    const state = campaign
      ? await this.workflowRepository.findState(campaign.id, creatorUserId)
      : null;
    const refreshedState = state ? await this.refreshWorkflowState(state.id) : null;
    const periodMonths = normalizeCampaignPeriodMonths(
      refreshedState?.campaign.periodMonths ?? campaign?.periodMonths ?? getActiveRosterResigningPeriodMonths()
    );
    const firstQueueCompleted = Boolean(refreshedState?.firstQueueCompletedAt);
    const expectedSecondQueueDocuments = periodMonths.flatMap((monthKey) =>
      SECOND_QUEUE_DOCUMENT_TYPES.map((type) => ({
        type,
        monthKey
      }))
    );
    const documents = expectedSecondQueueDocuments.map((expectedDocument) => {
      const linkedDocument = pickBestWorkflowDocument(
        refreshedState?.documents
          .filter(
            (link) =>
              link.queue === DocumentWorkflowQueue.SECOND_QUEUE &&
              link.document.type === expectedDocument.type &&
              link.document.monthKey === expectedDocument.monthKey
          )
          .map((link) => link.document) ?? []
      );
      const paymentStatus = getPaymentQueueStatus(refreshedState, expectedDocument.monthKey);

      if (!firstQueueCompleted) {
        return {
          ...expectedDocument,
          status: 'LOCKED' as const,
          ...paymentStatus
        };
      }

      if (!linkedDocument || !isUsableWorkflowDocument(linkedDocument)) {
        return {
          ...expectedDocument,
          status: 'NOT_GENERATED' as const,
          ...paymentStatus
        };
      }

      const payload = linkedDocument.payloadJson as Record<string, unknown>;
      const payment = payload.payment as Record<string, unknown> | undefined;

      return {
        ...expectedDocument,
        documentId: linkedDocument.id,
        status: linkedDocument.status,
        generatedAt: linkedDocument.generatedAt,
        sentAt: linkedDocument.sentAt,
        signedUploadedAt: linkedDocument.signedUploadedAt,
        forwardedAt: linkedDocument.forwardedAt,
        latestUploadName: linkedDocument.signatureUploads[0]?.originalFileName ?? null,
        ...paymentStatus,
        totalPayment: typeof payment?.totalPayment === 'number' ? payment.totalPayment : null,
        fixedSalaryPart: typeof payment?.fixedSalaryPart === 'number' ? payment.fixedSalaryPart : null,
        variablePart: typeof payment?.variablePart === 'number' ? payment.variablePart : null,
        actualVideoCount: typeof payment?.actualVideoCount === 'number' ? payment.actualVideoCount : null,
        rawViews: typeof payment?.rawViews === 'number' ? payment.rawViews : null
      };
    });
    const payments = periodMonths.map((monthKey) => ({
      monthKey,
      secondQueueSigned: refreshedState ? isSecondQueueSignedForMonth(refreshedState, monthKey) : false,
      totalPayment: getActTotalPaymentForMonth(refreshedState, monthKey),
      ...getPaymentQueueStatus(refreshedState, monthKey)
    }));

    return {
      campaignKey: refreshedState?.campaign.key ?? campaign?.key ?? campaignKey,
      campaignTitle: refreshedState?.campaign.title ?? campaign?.title ?? getActiveRosterResigningTitle(),
      periodMonths,
      isPrepared: Boolean(refreshedState),
      isFirstQueueCompleted: firstQueueCompleted,
      isCompleted: Boolean(refreshedState?.actSignedAt),
      completedAt: refreshedState?.actSignedAt,
      lockedReason: firstQueueCompleted
        ? undefined
        : 'Вторая очередь доступна после подписания договора и NDA.',
      documents,
      payments
    };
  }

  async registerGeneratedDocument(input: {
    documentId: string;
    campaignId: string;
    queue?: DocumentWorkflowQueue;
    required?: boolean;
  }) {
    const document = await this.documentRepository.findById(input.documentId);

    if (!document) {
      throw new Error('Документ для workflow не найден');
    }

    const queue = input.queue ?? getDefaultDocumentWorkflowQueue(document.type);

    if (!queue) {
      logger.info(
        { documentId: document.id, type: document.type },
        'Document workflow skipped for document type without queue'
      );
      return null;
    }

    const state = await this.workflowRepository.ensureState({
      campaignId: input.campaignId,
      creatorUserId: document.creatorUserId
    });

    await this.workflowRepository.linkDocument({
      workflowStateId: state.id,
      documentId: document.id,
      queue,
      required: input.required ?? true
    });

    return this.refreshWorkflowState(state.id);
  }

  async handleSignedDocument(documentId: string) {
    const states = await this.workflowRepository.findStatesByDocumentId(documentId);

    for (const state of states) {
      await this.refreshWorkflowState(state.id);
    }
  }

  async refreshWorkflowState(stateId: string) {
    const state = await this.workflowRepository.findStateById(stateId);

    if (!state) {
      throw new Error('Состояние документооборота не найдено');
    }

    const firstQueueCompleted = isFirstQueueSigned(state);
    const secondQueueCompleted = isSecondQueueSignedForAllPeriodMonths(state);
    const invoiceUpload = getLatestPaymentUpload(state, PaymentDocumentType.INVOICE);
    const receiptUpload = getLatestPaymentUpload(state, PaymentDocumentType.RECEIPT);
    const pendingReceiptInvoice = getPendingReceiptInvoice(state);
    const invoiceUploadedAt = invoiceUpload?.uploadedAt ?? null;
    const receiptUploadedAt = receiptUpload?.uploadedAt ?? null;
    const firstQueueCompletedAt = firstQueueCompleted ? state.firstQueueCompletedAt ?? new Date() : null;
    const actSignedAt = secondQueueCompleted ? state.actSignedAt ?? new Date() : null;
    const invoiceAvailableAt = secondQueueCompleted ? state.invoiceAvailableAt ?? actSignedAt ?? new Date() : null;
    const receiptExpectedAt = pendingReceiptInvoice
      ? getReceiptExpectedAtForInvoice(state, pendingReceiptInvoice)
      : null;
    const receiptReminderDueAt = pendingReceiptInvoice
      ? getReceiptReminderDueAtForInvoice(state, pendingReceiptInvoice)
      : null;
    const receiptReminderSentAt = pendingReceiptInvoice
      ? getReceiptReminderSentAtForInvoice(state, pendingReceiptInvoice)
      : null;

    return this.workflowRepository.updateState(state.id, {
      status: receiptUploadedAt && !pendingReceiptInvoice
        ? CreatorDocumentWorkflowStatus.COMPLETED
        : state.status === CreatorDocumentWorkflowStatus.CANCELLED
          ? CreatorDocumentWorkflowStatus.CANCELLED
          : CreatorDocumentWorkflowStatus.ACTIVE,
      firstQueueCompletedAt,
      actSignedAt,
      invoiceAvailableAt,
      invoiceUploadedAt,
      receiptExpectedAt,
      receiptReminderDueAt,
      receiptReminderSentAt,
      receiptUploadedAt
    });
  }

  async canGenerateSecondQueue(creatorUserId: string, campaignId: string) {
    const state = await this.workflowRepository.findState(campaignId, creatorUserId);

    if (!state) {
      return {
        allowed: false,
        reason: 'Сначала нужно подготовить первую очередь документов.'
      };
    }

    const refreshed = await this.refreshWorkflowState(state.id);

    return refreshed.firstQueueCompletedAt
      ? { allowed: true as const, state: refreshed }
      : {
        allowed: false as const,
        state: refreshed,
        reason: 'Вторая очередь станет доступна после подписания договора и NDA.'
      };
  }

  async canUploadInvoice(
    creatorUserId: string,
    monthKey?: string,
    campaignKey = getActiveRosterResigningCampaignKey()
  ) {
    if (monthKey && !isCreatorInvoiceMonth(monthKey)) {
      return {
        allowed: false as const,
        reason: `Счет сейчас нужен только за ${getCreatorInvoiceMonthKey()}.`
      };
    }

    const state =
      campaignKey === getNoContractPaymentCampaignKey()
        ? await this.prepareNoContractPaymentWorkflow(creatorUserId)
        : await this.workflowRepository.findStateByCampaignKey(campaignKey, creatorUserId);

    if (!state) {
      return {
        allowed: false,
        reason: buildSecondQueueRequiredMessage(monthKey)
      };
    }

    const refreshed = await this.refreshWorkflowState(state.id);

    if (isNoContractPaymentState(refreshed)) {
      const periodMonths = normalizeCampaignPeriodMonths(refreshed.campaign.periodMonths);

      if (monthKey && !periodMonths.includes(monthKey)) {
        return {
          allowed: false as const,
          state: refreshed,
          reason: `Счет доступен только за период: ${periodMonths.join(', ')}.`
        };
      }

      return { allowed: true as const, state: refreshed };
    }

    if (monthKey) {
      const missingSecondQueueDocuments = getMissingSecondQueueSignedDocumentTypes(refreshed, monthKey);

      return missingSecondQueueDocuments.length === 0
        ? { allowed: true as const, state: refreshed }
        : {
            allowed: false as const,
            state: refreshed,
            reason: buildSecondQueueRequiredMessage(monthKey, missingSecondQueueDocuments)
          };
    }

    return refreshed.invoiceAvailableAt
      ? { allowed: true as const, state: refreshed }
      : {
          allowed: false as const,
          state: refreshed,
          reason: buildSecondQueueRequiredMessage()
        };
  }

  async canUploadReceipt(
    creatorUserId: string,
    monthKey: string,
    campaignKey = getActiveRosterResigningCampaignKey()
  ) {
    if (!isCreatorInvoiceMonth(monthKey)) {
      return {
        allowed: false as const,
        reason: `Чек сейчас нужен только за ${getCreatorInvoiceMonthKey()}.`
      };
    }

    const state = await this.workflowRepository.findStateByCampaignKey(campaignKey, creatorUserId);

    if (!state) {
      return {
        allowed: false,
        reason: 'Чек станет доступен после загрузки счета.'
      };
    }

    const refreshed = await this.refreshWorkflowState(state.id);
    const invoiceUpload = getLatestPaymentUpload(refreshed, PaymentDocumentType.INVOICE, monthKey);

    return invoiceUpload
      ? { allowed: true as const, state: refreshed, invoice: invoiceUpload }
      : {
          allowed: false as const,
          state: refreshed,
          reason: `Сначала нужно загрузить счет за ${monthKey}.`
        };
  }

  async recordPaymentUpload(input: {
    workflowStateId: string;
    creatorUserId: string;
    type: PaymentDocumentType;
    monthKey?: string;
    telegramFileId?: string;
    telegramDocumentId?: string;
    originalFileName: string;
    mimeType?: string;
    filePath?: string;
    uploadedAt?: Date;
  }) {
    const state = await this.workflowRepository.findStateById(input.workflowStateId);

    if (!state || state.creatorUserId !== input.creatorUserId) {
      throw new Error('Состояние документооборота для загрузки не найдено');
    }

    const refreshed = await this.refreshWorkflowState(state.id);
    const uploadedAt = input.uploadedAt ?? new Date();
    let invoiceForReceipt: PaymentDocumentUpload | null = null;

    if (input.type === PaymentDocumentType.INVOICE) {
      if (!input.monthKey) {
        throw new Error('Выбери период, за который загружается счет.');
      }

      const missingSecondQueueDocuments = isNoContractPaymentState(refreshed)
        ? []
        : getMissingSecondQueueSignedDocumentTypes(refreshed, input.monthKey);

      if (missingSecondQueueDocuments.length > 0) {
        throw new Error(buildSecondQueueRequiredMessage(input.monthKey, missingSecondQueueDocuments));
      }
    }

    if (input.type === PaymentDocumentType.RECEIPT) {
      if (!input.monthKey) {
        throw new Error('Выбери период, за который загружается чек.');
      }

      const invoiceUpload = getLatestPaymentUpload(refreshed, PaymentDocumentType.INVOICE, input.monthKey);
      invoiceForReceipt = invoiceUpload ?? null;

      if (!invoiceUpload) {
        throw new Error(`Сначала нужно загрузить счет за ${input.monthKey}.`);
      }
    }

    await this.workflowRepository.createPaymentUpload({
      ...input,
      uploadedAt,
      status: PaymentDocumentStatus.UPLOADED,
      receiptExpectedAt: input.type === PaymentDocumentType.INVOICE ? uploadedAt : null,
      receiptReminderDueAt:
        input.type === PaymentDocumentType.INVOICE ? addReceiptReminderDelay(uploadedAt) : null,
      receiptReminderSentAt: null
    });

    if (input.type === PaymentDocumentType.RECEIPT && invoiceForReceipt) {
      await this.workflowRepository.clearInvoiceReceiptReminderDue({
        workflowStateId: refreshed.id,
        creatorUserId: input.creatorUserId,
        monthKey: input.monthKey,
        receiptUploadedAt: uploadedAt
      });
    }

    return this.refreshWorkflowState(state.id);
  }

  async listReceiptReminderDue(now = new Date()) {
    return this.workflowRepository.listReceiptReminderDue(now);
  }

  async markReceiptExpectedForMonth(
    creatorUserId: string,
    monthKey: string,
    startedAt = new Date(),
    campaignKey = getActiveRosterResigningCampaignKey()
  ): Promise<ReceiptExpectationMarkResult> {
    const state = await this.workflowRepository.findStateByCampaignKey(campaignKey, creatorUserId);

    if (!state) {
      return { status: 'NO_WORKFLOW' };
    }

    const refreshed = await this.refreshWorkflowState(state.id);
    const invoiceUpload = getLatestPaymentUpload(refreshed, PaymentDocumentType.INVOICE, monthKey);

    if (!invoiceUpload) {
      return { status: 'NO_INVOICE' };
    }

    const receiptUpload = getReceiptForInvoice(refreshed, invoiceUpload);

    if (receiptUpload) {
      return {
        status: 'RECEIPT_UPLOADED',
        receiptUploadedAt: receiptUpload.uploadedAt
      };
    }

    const reminderSentAt = getReceiptReminderSentAtForInvoice(refreshed, invoiceUpload);

    if (reminderSentAt) {
      return {
        status: 'REMINDER_ALREADY_SENT',
        receiptReminderSentAt: reminderSentAt
      };
    }

    const existingReceiptExpectedAt = getReceiptExpectedAtForInvoice(refreshed, invoiceUpload);
    const existingReceiptReminderDueAt = getReceiptReminderDueAtForInvoice(refreshed, invoiceUpload);

    if (existingReceiptExpectedAt && existingReceiptReminderDueAt) {
      if (!invoiceUpload.receiptExpectedAt || !invoiceUpload.receiptReminderDueAt) {
        await this.workflowRepository.updatePaymentUpload(invoiceUpload.id, {
          receiptExpectedAt: existingReceiptExpectedAt,
          receiptReminderDueAt: existingReceiptReminderDueAt,
          receiptReminderSentAt: null
        });
        await this.refreshWorkflowState(refreshed.id);
      }

      return {
        status: 'ALREADY_WAITING',
        receiptExpectedAt: existingReceiptExpectedAt,
        receiptReminderDueAt: existingReceiptReminderDueAt
      };
    }

    const receiptReminderDueAt = addReceiptReminderDelay(startedAt);

    await this.workflowRepository.updatePaymentUpload(invoiceUpload.id, {
      receiptExpectedAt: startedAt,
      receiptReminderDueAt,
      receiptReminderSentAt: null
    });
    await this.refreshWorkflowState(refreshed.id);

    return {
      status: 'WAITING',
      receiptExpectedAt: startedAt,
      receiptReminderDueAt
    };
  }

  async markReceiptReminderSent(stateId: string, sentAt = new Date(), invoiceUploadId?: string) {
    if (invoiceUploadId) {
      await this.workflowRepository.markPaymentUploadReceiptReminderSent(invoiceUploadId, sentAt);
    }

    await this.workflowRepository.markReceiptReminderSent(stateId, sentAt);

    return this.refreshWorkflowState(stateId);
  }
}
