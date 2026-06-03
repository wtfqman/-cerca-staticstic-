import fsSync from 'node:fs';

import { DocumentStatus, DocumentType, DocumentWorkflowQueue, LegalType } from '@prisma/client';
import { Input, type Telegram } from 'telegraf';

import { DocumentRepository } from '../repositories/document.repository';
import {
  CURRENT_DOCX_RENDER_PIPELINE_VERSION,
  isAllowedDocxTemplateSourceKind
} from '../documents/docx-template-manifest';
import { FileStorageService } from './file-storage.service';
import { DocumentPayloadBuilderService } from './document-payload-builder.service';
import { DocxTemplateRenderService } from './docx-template-render.service';
import { NotificationService } from './notification.service';
import { getDocumentScopeKey, getDocumentTitle } from '../documents/document.constants';
import { formatDocumentCaption, formatDocumentStatus } from '../documents/document.formatters';
import { toDateOnly, getMonthRange } from '../utils/periods';
import { GoogleSheetsSyncService } from './google-sheets-sync.service';
import type { DocumentWorkflowService } from './document-workflow.service';
import { logger } from '../lib/logger';
import { getCurrentDocumentLayoutRevision } from '../documents/document-layout-revisions';
import {
  SECOND_QUEUE_DOCUMENT_TYPES,
  getActiveRosterContractDate,
  getWorkflowDocumentScopeKey,
  normalizeCampaignPeriodMonths
} from '../documents/document-workflow.constants';
import {
  PERMANENT_SIGNATURE_DOCUMENT_TYPES,
  isCurrentOrPermanentSignatureDocument,
  isPermanentSignatureDocumentType
} from '../documents/document-reuse.helpers';

const SIGNED_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

export class StaleDocumentTemplateError extends Error {
  constructor() {
    super(
      'Документ не отправлен: он был сформирован из старого локального шаблона. ' +
        'Сформируй пакет заново после импорта актуальных шаблонов.'
    );
    this.name = 'StaleDocumentTemplateError';
  }
}

export const isStaleDocumentTemplateError = (error: unknown) =>
  error instanceof StaleDocumentTemplateError;

export const isApprovedTemplateDocumentPayload = (payloadJson: unknown, type?: DocumentType) => {
  const payload = typeof payloadJson === 'object' && payloadJson !== null
    ? payloadJson as Record<string, unknown>
    : {};
  const template = typeof payload.docxTemplate === 'object' && payload.docxTemplate !== null
    ? payload.docxTemplate as Record<string, unknown>
    : null;
  const currentLayoutRevision = type ? getCurrentDocumentLayoutRevision(type) : null;

  return (
    isAllowedDocxTemplateSourceKind(template?.sourceKind) &&
    template?.pipelineVersion === CURRENT_DOCX_RENDER_PIPELINE_VERSION &&
    (currentLayoutRevision === null || template?.layoutRevision === currentLayoutRevision)
  );
};

export interface SentDocumentInfo {
  documentId: string;
  type: DocumentType;
  monthKey: string | null;
  filePath: string;
  status: DocumentStatus;
  telegramMessageId: number;
}

export interface SentCreatorDocumentBatchInfo {
  documentId: string;
  type: DocumentType;
  monthKey: string | null;
  filePath: string;
  telegramMessageId: number;
}

export interface SkippedCreatorDocumentBatchInfo {
  documentId: string;
  type: DocumentType;
  monthKey: string | null;
  filePath: string;
  reason: string;
}

export interface MissingFirstQueueDocumentInfo {
  type: DocumentType;
  monthKey: string | null;
  status: string;
  documentId: string | null;
}

export class FirstQueueDocumentPackageIncompleteError extends Error {
  constructor(readonly missingDocuments: MissingFirstQueueDocumentInfo[]) {
    super(
      `First queue document package is incomplete: ${missingDocuments
        .map((document) => `${document.type}${document.monthKey ? `:${document.monthKey}` : ''}`)
        .join(', ')}`
    );
    this.name = 'FirstQueueDocumentPackageIncompleteError';
  }
}

type SendableDocument = NonNullable<Awaited<ReturnType<DocumentRepository['findById']>>>;
type CreatorBatchDocument = Awaited<ReturnType<DocumentRepository['listByCreator']>>[number];
type OneOffDocument = Awaited<ReturnType<DocumentRepository['listOneOffByCreatorAndTypes']>>[number];

const DOCUMENT_FILE_LABELS: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'договор',
  [DocumentType.NDA]: 'NDA',
  [DocumentType.ASSIGNMENT]: 'задание',
  [DocumentType.ACT]: 'акт',
  [DocumentType.RIGHTS_TRANSFER]: 'передача_прав'
};

const CREATOR_DOCUMENT_BATCH_ORDER: Record<DocumentType, number> = {
  [DocumentType.CONTRACT]: 10,
  [DocumentType.NDA]: 20,
  [DocumentType.ASSIGNMENT]: 30,
  [DocumentType.ACT]: 40,
  [DocumentType.RIGHTS_TRANSFER]: 50
};

const sanitizeTelegramFileNamePart = (value: string) => {
  const sanitized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return sanitized || 'creator';
};

const getCreatorSurnameForFileName = (
  creator: Pick<SendableDocument['creator'], 'creatorProfile' | 'firstName' | 'lastName' | 'username'> | null,
  fallbackName?: string
) => {
  const fullName = creator?.creatorProfile?.fullName?.trim();
  const telegramName = [creator?.lastName, creator?.firstName].filter(Boolean).join(' ').trim();
  const sourceName = fullName || telegramName || creator?.username || fallbackName || 'creator';
  const surname = sourceName.split(/\s+/)[0] || sourceName;

  return sanitizeTelegramFileNamePart(surname);
};

const formatCreatorDocumentFileName = (input: {
  creatorSurname: string;
  type: DocumentType;
  monthKey?: string | null;
}) => {
  const label = sanitizeTelegramFileNamePart(DOCUMENT_FILE_LABELS[input.type]);
  const monthPart = input.monthKey ? `_${sanitizeTelegramFileNamePart(input.monthKey)}` : '';

  return `${input.creatorSurname}_${label}${monthPart}.pdf`;
};

const formatGeneratedDocumentFileName = (document: SendableDocument) =>
  formatCreatorDocumentFileName({
    creatorSurname: getCreatorSurnameForFileName(document.creator),
    type: document.type,
    monthKey: document.monthKey
  });

const formatCreatorBatchDocumentTitle = (document: Pick<CreatorBatchDocument, 'type' | 'monthKey'>) =>
  `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}`;

const sortCreatorBatchDocuments = (left: CreatorBatchDocument, right: CreatorBatchDocument) => {
  const orderDiff = CREATOR_DOCUMENT_BATCH_ORDER[left.type] - CREATOR_DOCUMENT_BATCH_ORDER[right.type];

  if (orderDiff !== 0) {
    return orderDiff;
  }

  const monthDiff = (left.monthKey ?? '').localeCompare(right.monthKey ?? '');

  if (monthDiff !== 0) {
    return monthDiff;
  }

  return left.generatedAt.getTime() - right.generatedAt.getTime();
};

const isCurrentWorkflowDocument = (document: { scopeKey?: string | null; type?: DocumentType | null }) =>
  isCurrentOrPermanentSignatureDocument(document);

const getReusableOneOffDocumentRank = (document: Pick<OneOffDocument, 'status' | 'payloadJson' | 'type'>) => {
  if (SIGNED_STATUSES.has(document.status)) {
    return 30;
  }

  if (isPermanentSignatureDocumentType(document.type) && document.status !== DocumentStatus.FAILED) {
    return 20;
  }

  if (isApprovedTemplateDocumentPayload(document.payloadJson, document.type)) {
    return 10;
  }

  return 0;
};

const getReusableOneOffDocumentTimestamp = (
  document: Pick<OneOffDocument, 'generatedAt' | 'sentAt' | 'signedUploadedAt' | 'forwardedAt'>
) =>
  document.forwardedAt?.getTime() ??
  document.signedUploadedAt?.getTime() ??
  document.sentAt?.getTime() ??
  document.generatedAt.getTime();

const pickReusableOneOffDocument = (documents: OneOffDocument[]) =>
  [...documents]
    .filter((document) => getReusableOneOffDocumentRank(document) > 0)
    .sort((left, right) => {
      const rankDiff = getReusableOneOffDocumentRank(right) - getReusableOneOffDocumentRank(left);

      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (
        left.type === right.type &&
        isPermanentSignatureDocumentType(left.type) &&
        !SIGNED_STATUSES.has(left.status) &&
        !SIGNED_STATUSES.has(right.status)
      ) {
        return getReusableOneOffDocumentTimestamp(left) - getReusableOneOffDocumentTimestamp(right);
      }

      return getReusableOneOffDocumentTimestamp(right) - getReusableOneOffDocumentTimestamp(left);
    })[0] ?? null;

const parsePayloadDate = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const russianDate = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (russianDate) {
    const [, day, month, year] = russianDate;
    return toDateOnly(`${year}-${month}-${day}`);
  }

  const isoDate = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoDate) {
    return toDateOnly(value.trim());
  }

  return null;
};

const getPayloadRecord = (payloadJson: unknown) =>
  typeof payloadJson === 'object' && payloadJson !== null
    ? payloadJson as Record<string, unknown>
    : {};

const getContractDateFromDocumentPayload = (document?: Pick<OneOffDocument, 'payloadJson'> | null) => {
  const payload = getPayloadRecord(document?.payloadJson);

  return parsePayloadDate(payload.contractDate) ??
    parsePayloadDate(payload.documentDate) ??
    parsePayloadDate(payload.generatedDate);
};

const getContractNumberFromDocumentPayload = (document?: Pick<OneOffDocument, 'payloadJson'> | null) => {
  const payload = getPayloadRecord(document?.payloadJson);

  if (typeof payload.contractNumber !== 'string') {
    return null;
  }

  const normalized = payload.contractNumber.trim();

  return normalized.length > 0 ? normalized : null;
};

type VisibleWorkflowDocument = {
  type: DocumentType;
  monthKey?: string | null;
  status: DocumentStatus;
  payloadJson: unknown;
  generatedAt: Date;
  sentAt?: Date | null;
  signedUploadedAt?: Date | null;
  forwardedAt?: Date | null;
};

const getVisibleWorkflowDocumentKey = (document: Pick<VisibleWorkflowDocument, 'type' | 'monthKey'>) =>
  `${document.type}:${document.monthKey ?? 'one-off'}`;

const getVisibleWorkflowDocumentRank = (
  document: Pick<VisibleWorkflowDocument, 'status' | 'payloadJson' | 'type'>
) => {
  if (SIGNED_STATUSES.has(document.status)) {
    return 30;
  }

  if (isPermanentSignatureDocumentType(document.type) && document.status !== DocumentStatus.FAILED) {
    return 20;
  }

  if (isApprovedTemplateDocumentPayload(document.payloadJson, document.type)) {
    return 10;
  }

  return 0;
};

const getVisibleWorkflowDocumentTimestamp = (
  document: Pick<VisibleWorkflowDocument, 'generatedAt' | 'sentAt' | 'signedUploadedAt' | 'forwardedAt'>
) =>
  document.forwardedAt?.getTime() ??
  document.signedUploadedAt?.getTime() ??
  document.sentAt?.getTime() ??
  document.generatedAt.getTime();

const compareVisibleWorkflowDocuments = <T extends VisibleWorkflowDocument>(left: T, right: T) => {
  const rankDiff = getVisibleWorkflowDocumentRank(right) - getVisibleWorkflowDocumentRank(left);

  if (rankDiff !== 0) {
    return rankDiff;
  }

  if (
    left.type === right.type &&
    isPermanentSignatureDocumentType(left.type) &&
    !SIGNED_STATUSES.has(left.status) &&
    !SIGNED_STATUSES.has(right.status)
  ) {
    return getVisibleWorkflowDocumentTimestamp(left) - getVisibleWorkflowDocumentTimestamp(right);
  }

  return getVisibleWorkflowDocumentTimestamp(right) - getVisibleWorkflowDocumentTimestamp(left);
};

const compactVisibleWorkflowDocuments = <T extends VisibleWorkflowDocument>(documents: T[]) => {
  const selected = new Map<string, T>();

  for (const document of documents) {
    const key = getVisibleWorkflowDocumentKey(document);
    const existing = selected.get(key);

    if (!existing || compareVisibleWorkflowDocuments(document, existing) < 0) {
      selected.set(key, document);
    }
  }

  return [...selected.values()].sort((left, right) => {
    const orderDiff = CREATOR_DOCUMENT_BATCH_ORDER[left.type] - CREATOR_DOCUMENT_BATCH_ORDER[right.type];

    if (orderDiff !== 0) {
      return orderDiff;
    }

    const monthDiff = (left.monthKey ?? '').localeCompare(right.monthKey ?? '');

    if (monthDiff !== 0) {
      return monthDiff;
    }

    return left.generatedAt.getTime() - right.generatedAt.getTime();
  });
};

const formatCreatorDocumentBatchHeader = (input: {
  creatorName: string;
  documents: CreatorBatchDocument[];
}) => {
  const periods = [...new Set(input.documents.map((document) => document.monthKey).filter(Boolean))];

  return [
    'Комплект документов креатора',
    `Креатор: ${input.creatorName}`,
    periods.length ? `Периоды: ${periods.join(', ')}` : null,
    `Файлов в комплекте: ${input.documents.length}`,
    '',
    'Состав:',
    ...input.documents.map((document, index) =>
      `${index + 1}. ${formatCreatorBatchDocumentTitle(document)} - ${formatDocumentStatus(document.status)}`
    )
  ]
    .filter(Boolean)
    .join('\n');
};

const formatCreatorDocumentBatchCaption = (document: CreatorBatchDocument) =>
  [
    formatCreatorBatchDocumentTitle(document),
    `Статус: ${formatDocumentStatus(document.status)}`,
    `Сформирован: ${document.generatedAt.toLocaleDateString('ru-RU')}`
  ].join('\n');

interface WorkflowDocumentGenerationOptions {
  campaignId?: string;
  queue?: DocumentWorkflowQueue;
  required?: boolean;
  generatedDate?: Date;
  workflow?: Record<string, unknown>;
  scopeKey?: string;
}

interface DocumentBatchOptions {
  syncSheets?: boolean;
}

export class DocumentService {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly payloadBuilder: DocumentPayloadBuilderService,
    private readonly docxTemplateRenderService: DocxTemplateRenderService,
    private readonly fileStorageService: FileStorageService,
    private readonly notificationService: NotificationService,
    private readonly googleSheetsSyncService?: GoogleSheetsSyncService,
    private readonly documentWorkflowService?: DocumentWorkflowService
  ) {}

  async generateOneOffDocuments(
    creatorUserId: string,
    telegram?: Telegram
  ) {
    await this.payloadBuilder.assertCreatorProfileCompleted(creatorUserId);

    const types: DocumentType[] = [DocumentType.CONTRACT, DocumentType.NDA];
    await this.assertTemplatesAvailable(creatorUserId, types);
    const documents = [];

    for (const type of types) {
      documents.push(await this.generateOneOffDocument(creatorUserId, type));
    }

    await this.googleSheetsSyncService?.safeSyncDocuments(documents.map((document) => document.id));
    await this.sendGeneratedDocumentsToCreator(telegram, documents.map((document) => document.id));

    return documents;
  }

  async generateMonthlyDocuments(creatorUserId: string, monthKey: string, telegram?: Telegram) {
    await this.payloadBuilder.assertCreatorProfileCompleted(creatorUserId);

    const types: DocumentType[] = [DocumentType.ASSIGNMENT];
    await this.assertTemplatesAvailable(creatorUserId, types);
    const monthRange = getMonthRange(monthKey);
    const contractReference = await this.resolveCreatorContractReference(
      creatorUserId,
      toDateOnly(monthRange.dateFrom)
    );
    const documents = [];

    for (const type of types) {
      const documentDate = type === DocumentType.ASSIGNMENT
        ? toDateOnly(monthRange.dateFrom)
        : toDateOnly(monthRange.dateTo);

      documents.push(
        await this.generateMonthlyDocument(creatorUserId, monthKey, type, undefined, {
          generatedDate: documentDate,
          workflow: {
            contractDate: contractReference.contractDate,
            contractNumber: contractReference.contractNumber,
            monthKey
          }
        })
      );
    }

    await this.googleSheetsSyncService?.safeSyncDocuments(documents.map((document) => document.id));
    await this.sendGeneratedDocumentsToCreator(telegram, documents.map((document) => document.id));

    return documents;
  }

  async generateActiveRosterResigningFirstQueueDocuments(
    creatorUserId: string,
    telegram?: Telegram,
    options: DocumentBatchOptions = {}
  ) {
    if (!this.documentWorkflowService) {
      throw new Error('Document workflow service is not configured');
    }

    const creator = await this.payloadBuilder.assertCreatorProfileCompleted(creatorUserId);
    const legalType = creator.creatorProfile!.legalType!;

    const state = await this.documentWorkflowService.prepareActiveRosterResigningWorkflow(creatorUserId);
    const campaign = state.campaign;
    const reusableContractDocument = await this.findReusableOneOffDocument(creatorUserId, DocumentType.CONTRACT);
    const defaultContractDate = campaign.contractDate ?? getActiveRosterContractDate();
    const contractDate = getContractDateFromDocumentPayload(reusableContractDocument) ?? defaultContractDate;
    const contractNumber = getContractNumberFromDocumentPayload(reusableContractDocument) ?? undefined;
    const workflowPayload = {
      campaignKey: campaign.key,
      campaignTitle: campaign.title,
      queue: DocumentWorkflowQueue.FIRST_QUEUE,
      contractDate,
      contractNumber
    };
    const documents = [];

    for (const type of PERMANENT_SIGNATURE_DOCUMENT_TYPES) {
      const reusableDocument = type === DocumentType.CONTRACT
        ? reusableContractDocument
        : await this.findReusableOneOffDocument(creatorUserId, type);

      if (reusableDocument) {
        await this.registerWorkflowDocument(reusableDocument.id, {
          campaignId: campaign.id,
          queue: DocumentWorkflowQueue.FIRST_QUEUE,
          required: true
        });
        documents.push(reusableDocument);
        continue;
      }

      this.assertTemplatesAvailableForLegalType(legalType, [type]);
      documents.push(
        await this.generateOneOffDocument(creatorUserId, type, undefined, {
          campaignId: campaign.id,
          queue: DocumentWorkflowQueue.FIRST_QUEUE,
          scopeKey: getWorkflowDocumentScopeKey({
            campaignKey: campaign.key,
            type
          }),
          generatedDate: contractDate,
          workflow: workflowPayload
        })
      );
    }

    if (options.syncSheets !== false) {
      await this.googleSheetsSyncService?.safeSyncDocuments(documents.map((document) => document.id));
    }
    await this.sendGeneratedDocumentsToCreator(telegram, documents.map((document) => document.id));

    return documents;
  }

  async generateActiveRosterResigningSecondQueueDocuments(creatorUserId: string, telegram?: Telegram) {
    if (!this.documentWorkflowService) {
      throw new Error('Document workflow service is not configured');
    }

    const creator = await this.payloadBuilder.assertCreatorProfileCompleted(creatorUserId);
    const legalType = creator.creatorProfile!.legalType!;

    const state = await this.documentWorkflowService.prepareActiveRosterResigningWorkflow(creatorUserId);
    const access = await this.documentWorkflowService.canGenerateSecondQueue(creatorUserId, state.campaignId);

    if (!access.allowed) {
      throw new Error(access.reason);
    }

    const periodMonths = normalizeCampaignPeriodMonths(state.campaign.periodMonths);
    const contractReference = await this.resolveCreatorContractReference(
      creatorUserId,
      state.campaign.contractDate ?? getActiveRosterContractDate()
    );
    const documents = [];
    this.assertTemplatesAvailableForLegalType(legalType, [...SECOND_QUEUE_DOCUMENT_TYPES]);

    for (const monthKey of periodMonths) {
      const monthRange = getMonthRange(monthKey);

      for (const type of SECOND_QUEUE_DOCUMENT_TYPES) {
        const documentDate = type === DocumentType.ASSIGNMENT
          ? toDateOnly(monthRange.dateFrom)
          : toDateOnly(monthRange.dateTo);

        documents.push(
          await this.generateMonthlyDocument(creatorUserId, monthKey, type, undefined, {
            campaignId: state.campaignId,
            queue: DocumentWorkflowQueue.SECOND_QUEUE,
            scopeKey: getWorkflowDocumentScopeKey({
              campaignKey: state.campaign.key,
              type,
              monthKey
            }),
            generatedDate: documentDate,
            workflow: {
              campaignKey: state.campaign.key,
              campaignTitle: state.campaign.title,
              queue: DocumentWorkflowQueue.SECOND_QUEUE,
              contractDate: contractReference.contractDate,
              contractNumber: contractReference.contractNumber,
              monthKey
            }
          })
        );
      }
    }

    await this.googleSheetsSyncService?.safeSyncDocuments(documents.map((document) => document.id));
    await this.sendGeneratedDocumentsToCreator(telegram, documents.map((document) => document.id));

    return documents;
  }

  async sendDocumentToCreator(
    telegram: Telegram,
    documentId: string,
    options: DocumentBatchOptions = {}
  ) {
    const document = await this.documentRepository.findById(documentId);

    if (!document) {
      throw new Error('Документ не найден');
    }

    this.assertDocumentCanBeSent(document);

    const message = await this.notificationService.sendDocument(
      telegram,
      document.creatorUserId,
      document.creator.telegramId,
      Input.fromLocalFile(document.filePath, formatGeneratedDocumentFileName(document)),
      formatDocumentCaption(document),
      {
        documentId: document.id,
        type: document.type
      }
    );

    await this.documentRepository.updateStatus(
      document.id,
      SIGNED_STATUSES.has(document.status) ? document.status : DocumentStatus.SENT_TO_CREATOR,
      {
        sentAt: new Date(),
        telegramMessageId: message.message_id
      }
    );
    if (options.syncSheets !== false) {
      await this.googleSheetsSyncService?.safeSyncDocuments([document.id]);
    }

    return message;
  }

  async sendActiveRosterResigningFirstQueueDocuments(
    creatorUserId: string,
    telegram: Telegram,
    options: DocumentBatchOptions = {}
  ): Promise<SentDocumentInfo[]> {
    if (!this.documentWorkflowService) {
      throw new Error('Document workflow service is not configured');
    }

    const summary = await this.documentWorkflowService.getActiveRosterFirstQueueSummary(creatorUserId);
    const missingDocuments = summary.documents
      .filter((document) => document.status === 'NOT_GENERATED' || !document.documentId)
      .map((document): MissingFirstQueueDocumentInfo => ({
        type: document.type,
        monthKey: document.monthKey,
        status: document.status,
        documentId: document.documentId ?? null
      }));

    if (missingDocuments.length > 0) {
      throw new FirstQueueDocumentPackageIncompleteError(missingDocuments);
    }

    const documents = await this.loadSendableDocuments(
      summary.documents
        .filter((document) => !SIGNED_STATUSES.has(document.status as DocumentStatus))
        .map((document) => document.documentId!)
    );
    const sentDocuments: SentDocumentInfo[] = [];

    for (const document of documents) {
      const fileStats = fsSync.statSync(document.filePath);

      logger.info(
        {
          creatorUserId,
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          fileSizeBytes: fileStats.size,
          fileMtime: fileStats.mtime.toISOString()
        },
        'Sending first queue document'
      );

      let message;

      try {
        message = await this.sendDocumentToCreator(telegram, document.id, options);
      } catch (error) {
        logger.error(
          {
            error,
            creatorUserId,
            documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          fileSizeBytes: fileStats.size,
          fileMtime: fileStats.mtime.toISOString()
        },
        'First queue document send failed'
      );
        throw error;
      }

      sentDocuments.push({
        documentId: document.id,
        type: document.type,
        monthKey: document.monthKey,
        filePath: document.filePath,
        status: SIGNED_STATUSES.has(document.status) ? document.status : DocumentStatus.SENT_TO_CREATOR,
        telegramMessageId: message.message_id
      });

      logger.info(
        {
          creatorUserId,
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          telegramMessageId: message.message_id
        },
        'First queue document sent'
      );
    }

    return sentDocuments;
  }

  private async sendGeneratedDocumentsToCreator(telegram: Telegram | undefined, documentIds: string[]) {
    if (!telegram) {
      return;
    }

    const documents = await this.loadSendableDocuments(documentIds);

    for (const document of documents) {
      if (SIGNED_STATUSES.has(document.status)) {
        continue;
      }

      await this.sendDocumentToCreator(telegram, document.id);
    }
  }

  private async loadSendableDocuments(documentIds: string[]) {
    const documents: SendableDocument[] = [];

    for (const documentId of documentIds) {
      const document = await this.documentRepository.findById(documentId);

      if (!document) {
        throw new Error(`Document was not found before sending: ${documentId}`);
      }

      const isAlreadySigned = SIGNED_STATUSES.has(document.status);

      if (!isAlreadySigned && !isPermanentSignatureDocumentType(document.type)) {
        this.assertDocumentCanBeSent(document);
      }

      if (!isAlreadySigned && !fsSync.existsSync(document.filePath)) {
        throw new Error(
          `PDF file is missing before sending: ${document.type}${document.monthKey ? ` ${document.monthKey}` : ''} (${document.filePath})`
        );
      }

      documents.push(document);
    }

    return documents;
  }

  private async assertTemplatesAvailable(creatorUserId: string, types: DocumentType[]) {
    const creator = await this.payloadBuilder.assertCreatorProfileCompleted(creatorUserId);
    const legalType = creator.creatorProfile!.legalType!;

    this.assertTemplatesAvailableForLegalType(legalType, types);
  }

  private assertTemplatesAvailableForLegalType(legalType: LegalType, types: readonly DocumentType[]) {
    for (const type of types) {
      try {
        this.docxTemplateRenderService.assertTemplateAvailable({
          type,
          legalType
        });
      } catch (error) {
        throw new Error(
          `Документы не отправлены: в Google Docs шаблоне не найдена корректная секция ${type}. ` +
            'Проверь импортированный шаблон и повтори формирование после исправления.'
        );
      }
    }
  }

  private assertDocumentCanBeSent(document: { payloadJson: unknown; type: DocumentType; status?: DocumentStatus }) {
    if (
      isPermanentSignatureDocumentType(document.type) &&
      document.status &&
      document.status !== DocumentStatus.FAILED
    ) {
      return;
    }

    if (!isApprovedTemplateDocumentPayload(document.payloadJson, document.type)) {
      throw new StaleDocumentTemplateError();
    }

    return;
  }

  private async findReusableOneOffDocument(creatorUserId: string, type: DocumentType) {
    const documents = await this.documentRepository.listOneOffByCreatorAndTypes(creatorUserId, [type]);

    return pickReusableOneOffDocument(documents);
  }

  private async resolveCreatorContractReference(creatorUserId: string, fallback: Date) {
    const reusableContractDocument = await this.findReusableOneOffDocument(creatorUserId, DocumentType.CONTRACT);

    return {
      contractDate: getContractDateFromDocumentPayload(reusableContractDocument) ?? fallback,
      contractNumber: getContractNumberFromDocumentPayload(reusableContractDocument) ?? undefined
    };
  }

  async listCreatorDocuments(creatorUserId: string) {
    return compactVisibleWorkflowDocuments(
      (await this.documentRepository.listByCreator(creatorUserId)).filter(isCurrentWorkflowDocument)
    );
  }

  async sendCreatorDocumentsBatchToChat(
    telegram: Telegram,
    input: {
      creatorUserId: string;
      creatorName: string;
      chatId: string | number;
      documents?: CreatorBatchDocument[];
    }
  ) {
    const documents = [...(input.documents ?? await this.documentRepository.listByCreator(input.creatorUserId))]
      .sort(sortCreatorBatchDocuments);

    if (documents.length === 0) {
      throw new Error('У креатора нет документов для отправки комплектом.');
    }

    const headerMessage = await telegram.sendMessage(
      input.chatId,
      formatCreatorDocumentBatchHeader({
        creatorName: input.creatorName,
        documents
      })
    );
    const sentDocuments: SentCreatorDocumentBatchInfo[] = [];
    const skippedDocuments: SkippedCreatorDocumentBatchInfo[] = [];

    for (const document of documents) {
      if (!fsSync.existsSync(document.filePath)) {
        const skippedDocument = {
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          reason: 'file_missing'
        };

        skippedDocuments.push(skippedDocument);
        logger.warn(
          {
            creatorUserId: input.creatorUserId,
            ...skippedDocument
          },
          'Creator document batch skipped missing file'
        );
        continue;
      }

      try {
        const creatorSurname = getCreatorSurnameForFileName(null, input.creatorName);
        const message = await telegram.sendDocument(
          input.chatId,
          Input.fromLocalFile(
            document.filePath,
            formatCreatorDocumentFileName({
              creatorSurname,
              type: document.type,
              monthKey: document.monthKey
            })
          ),
          {
            caption: formatCreatorDocumentBatchCaption(document)
          }
        );

        sentDocuments.push({
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          telegramMessageId: message.message_id
        });
      } catch (error) {
        const skippedDocument = {
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          reason: error instanceof Error ? error.message : 'send_failed'
        };

        skippedDocuments.push(skippedDocument);
        logger.error(
          {
            error,
            creatorUserId: input.creatorUserId,
            ...skippedDocument
          },
          'Creator document batch send failed for one file'
        );
      }
    }

    logger.info(
      {
        creatorUserId: input.creatorUserId,
        chatId: input.chatId,
        headerMessageId: headerMessage.message_id,
        sentDocumentCount: sentDocuments.length,
        skippedDocumentCount: skippedDocuments.length,
        documents: sentDocuments,
        skippedDocuments
      },
      'Creator document batch sent to chat'
    );

    return {
      headerMessageId: headerMessage.message_id,
      sentDocuments,
      skippedDocuments
    };
  }

  async sendAllCreatorDocumentsToCreator(
    telegram: Telegram,
    creatorUserId: string,
    options: DocumentBatchOptions = {}
  ) {
    const documents = [...await this.listCreatorResendableDocuments(creatorUserId)].sort(sortCreatorBatchDocuments);
    const sentDocuments: SentCreatorDocumentBatchInfo[] = [];
    const skippedDocuments: SkippedCreatorDocumentBatchInfo[] = [];

    if (documents.length === 0) {
      throw new Error('У тебя пока нет актуальных PDF для повторной отправки.');
    }

    for (const document of documents) {
      if (!fsSync.existsSync(document.filePath)) {
        const skippedDocument = {
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          reason: 'file_missing'
        };

        skippedDocuments.push(skippedDocument);
        logger.warn(
          {
            creatorUserId,
            ...skippedDocument
          },
          'Creator document resend skipped missing file'
        );
        continue;
      }

      try {
        const message = await this.sendDocumentToCreator(telegram, document.id, options);

        sentDocuments.push({
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          telegramMessageId: message.message_id
        });
      } catch (error) {
        const skippedDocument = {
          documentId: document.id,
          type: document.type,
          monthKey: document.monthKey,
          filePath: document.filePath,
          reason: error instanceof Error ? error.message : 'send_failed'
        };

        skippedDocuments.push(skippedDocument);
        logger.error(
          {
            error,
            creatorUserId,
            ...skippedDocument
          },
          'Creator document resend failed for one file'
        );
      }
    }

    logger.info(
      {
        creatorUserId,
        sentDocumentCount: sentDocuments.length,
        skippedDocumentCount: skippedDocuments.length,
        documents: sentDocuments,
        skippedDocuments
      },
      'All creator documents resent to creator'
    );

    return {
      sentDocuments,
      skippedDocuments
    };
  }

  async listCreatorResendableDocuments(creatorUserId: string) {
    const documents = await this.documentRepository.listByCreator(creatorUserId);

    return compactVisibleWorkflowDocuments(
      documents.filter(
        (document) =>
          isCurrentWorkflowDocument(document) &&
          (
            isPermanentSignatureDocumentType(document.type) ||
            isApprovedTemplateDocumentPayload(document.payloadJson, document.type)
          )
      )
    );
  }

  async listPendingSignatureDocuments(creatorUserId: string) {
    return compactVisibleWorkflowDocuments(
      (await this.documentRepository.listPendingSignatureByCreator(creatorUserId)).filter(isCurrentWorkflowDocument)
    );
  }

  async listSignatureUploadDocuments(creatorUserId: string) {
    return compactVisibleWorkflowDocuments(
      (await this.documentRepository.listSignatureUploadCandidatesByCreator(creatorUserId)).filter(
        isCurrentWorkflowDocument
      )
    );
  }

  async resendDocument(telegram: Telegram, documentId: string) {
    return this.sendDocumentToCreator(telegram, documentId);
  }

  async findDocumentByReplyContext(creatorUserId: string, telegramMessageId: number) {
    return this.documentRepository.findByCreatorAndMessage(creatorUserId, telegramMessageId);
  }

  private async generateOneOffDocument(
    creatorUserId: string,
    type: DocumentType,
    telegram?: Telegram,
    options: WorkflowDocumentGenerationOptions = {}
  ) {
    const payload = await this.payloadBuilder.buildOneOffPayload(creatorUserId, type, {
      generatedDate: options.generatedDate,
      workflow: options.workflow
    });
    const legalType = payload.creator.legalType as LegalType;
    const rendered = await this.renderPdfFromDocxTemplate(type, legalType, payload);
    const stored = await this.fileStorageService.saveGeneratedPdf({
      creatorUserId,
      type,
      buffer: rendered.pdfBuffer,
      scopeKey: options.scopeKey
    });
    const document = await this.documentRepository.upsertDocument({
      creatorUserId,
      type,
      legalType,
      scopeKey: options.scopeKey ?? getDocumentScopeKey(type),
      filePath: stored.filePath,
      fileName: stored.fileName,
      payloadJson: rendered.payloadJson
    });

    await this.registerWorkflowDocument(document.id, options);

    if (telegram && !SIGNED_STATUSES.has(document.status)) {
      await this.sendDocumentToCreator(telegram, document.id);
    }

    return document;
  }

  private async generateMonthlyDocument(
    creatorUserId: string,
    monthKey: string,
    type: DocumentType,
    telegram?: Telegram,
    options: WorkflowDocumentGenerationOptions = {}
  ) {
    const monthRange = getMonthRange(monthKey);
    const payload = await this.payloadBuilder.buildMonthlyPayload(creatorUserId, monthKey, type, {
      generatedDate: options.generatedDate,
      workflow: options.workflow
    });
    const legalType = payload.legalType as LegalType;
    const rendered = await this.renderPdfFromDocxTemplate(type, legalType, payload);
    const stored = await this.fileStorageService.saveGeneratedPdf({
      creatorUserId,
      type,
      buffer: rendered.pdfBuffer,
      monthKey,
      scopeKey: options.scopeKey
    });
    const document = await this.documentRepository.upsertDocument({
      creatorUserId,
      type,
      legalType,
      scopeKey: options.scopeKey ?? getDocumentScopeKey(type, monthKey),
      monthKey,
      periodStart: toDateOnly(monthRange.dateFrom),
      periodEnd: toDateOnly(monthRange.dateTo),
      filePath: stored.filePath,
      fileName: stored.fileName,
      payloadJson: rendered.payloadJson
    });

    await this.registerWorkflowDocument(document.id, options);

    if (telegram && !SIGNED_STATUSES.has(document.status)) {
      await this.sendDocumentToCreator(telegram, document.id);
    }

    return document;
  }

  private async registerWorkflowDocument(documentId: string, options: WorkflowDocumentGenerationOptions) {
    if (!options.campaignId || !this.documentWorkflowService) {
      return;
    }

    await this.documentWorkflowService.registerGeneratedDocument({
      documentId,
      campaignId: options.campaignId,
      queue: options.queue,
      required: options.required
    });
  }

  private async renderPdfFromDocxTemplate(
    type: DocumentType,
    legalType: LegalType,
    payload: Record<string, unknown>
  ) {
    return this.docxTemplateRenderService.render({
      type,
      legalType,
      payload
    });
  }
}
