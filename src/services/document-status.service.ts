import { DocumentStatus, DocumentType, type LegalType } from '@prisma/client';

import type { CreatorDocumentStatusSummary, RequiredDocumentStatusSummary } from '../types/report.types';
import { DocumentRepository } from '../repositories/document.repository';
import { formatAssignedTeamLeadName, formatCreatorDisplayName } from '../utils/formatters';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';
import { isCurrentDocumentWorkflowScopeKey } from '../documents/document-workflow.constants';

type CreatorReference = {
  id: string;
  isActive?: boolean | null;
  firstName?: string | null;
  lastName?: string | null;
  telegramId?: string | null;
  creatorProfile?: {
    fullName?: string | null;
    legalType?: LegalType | null;
    profileCompleted?: boolean | null;
  } | null;
  creatorAssignments?: Array<{
    teamLead: {
      firstName?: string | null;
      lastName?: string | null;
      telegramId?: string | null;
      teamLeadProfile?: {
        displayName?: string | null;
      } | null;
    };
  }>;
};

const isActiveCreator = (creator: CreatorReference) => creator.isActive !== false;

const ONE_OFF_DOCUMENT_TYPES = [DocumentType.CONTRACT, DocumentType.NDA];
const MONTHLY_DOCUMENT_TYPES = [DocumentType.ASSIGNMENT, DocumentType.ACT, DocumentType.RIGHTS_TRANSFER];
const OPTIONAL_FOR_MANUAL_CHECK = new Set<DocumentType>([DocumentType.CONTRACT]);
const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

export class DocumentStatusService {
  constructor(private readonly documentRepository: DocumentRepository) {}

  async getCreatorSummary(creator: CreatorReference, monthKey: string): Promise<CreatorDocumentStatusSummary> {
    const documents = await this.documentRepository.listForSheetSync({
      creatorUserId: creator.id
    });

    return this.buildCreatorSummary(creator, documents, monthKey);
  }

  async getSummariesForCreators(
    creators: CreatorReference[],
    monthKey: string
  ): Promise<CreatorDocumentStatusSummary[]> {
    const activeCreators = creators.filter(isActiveCreator);
    const documents = await this.documentRepository.listForSheetSync({
      creatorIds: activeCreators.map((creator) => creator.id)
    });
    const documentsByCreator = new Map<string, typeof documents>();

    for (const document of documents) {
      const bucket = documentsByCreator.get(document.creatorUserId) ?? [];
      bucket.push(document);
      documentsByCreator.set(document.creatorUserId, bucket);
    }

    return activeCreators.map((creator) =>
      this.buildCreatorSummary(creator, documentsByCreator.get(creator.id) ?? [], monthKey)
    );
  }

  async listCreatorsWithMissingSignedDocuments(creators: CreatorReference[], monthKey: string) {
    const summaries = await this.getSummariesForCreators(creators, monthKey);
    return summaries.filter((summary) => summary.hasMissingSignedDocuments);
  }

  private buildCreatorSummary(
    creator: CreatorReference,
    documents: Awaited<ReturnType<DocumentRepository['listForSheetSync']>>,
    monthKey: string
  ): CreatorDocumentStatusSummary {
    if (isNoContractCreatorProfile(creator.creatorProfile)) {
      return {
        creatorUserId: creator.id,
        creatorName: formatCreatorDisplayName(creator),
        teamLeadName: formatAssignedTeamLeadName(creator),
        monthKey,
        oneOff: [],
        monthly: [],
        missingGeneratedCount: 0,
        missingSignedCount: 0,
        hasMissingSignedDocuments: false
      };
    }

    const currentDocuments = documents.filter((document) => isCurrentDocumentWorkflowScopeKey(document.scopeKey));
    const permanentDocuments = new Map(
      currentDocuments
        .filter((document) => !document.monthKey)
        .map((document) => [document.type, document] as const)
    );
    const monthlyDocuments = new Map(
      currentDocuments
        .filter((document) => document.monthKey === monthKey)
        .map((document) => [document.type, document] as const)
    );
    const oneOff = ONE_OFF_DOCUMENT_TYPES.map((type) =>
      this.buildRequiredDocumentSummary(type, permanentDocuments.get(type))
    );
    const monthly = MONTHLY_DOCUMENT_TYPES.map((type) =>
      this.buildRequiredDocumentSummary(type, monthlyDocuments.get(type), monthKey)
    );
    const allRequirements = [...oneOff, ...monthly];
    const requiredDocuments = allRequirements.filter((item) => item.required);

    return {
      creatorUserId: creator.id,
      creatorName: formatCreatorDisplayName(creator),
      teamLeadName: formatAssignedTeamLeadName(creator),
      monthKey,
      oneOff,
      monthly,
      missingGeneratedCount: requiredDocuments.filter((item) => !item.generated).length,
      missingSignedCount: requiredDocuments.filter((item) => !item.signed).length,
      hasMissingSignedDocuments: requiredDocuments.some((item) => !item.signed)
    };
  }

  private buildRequiredDocumentSummary(
    type: DocumentType,
    document?: Awaited<ReturnType<DocumentRepository['listForSheetSync']>>[number],
    monthKey?: string
  ): RequiredDocumentStatusSummary {
    const generated = Boolean(document && document.status !== DocumentStatus.FAILED);
    const signed = Boolean(document && SIGNED_DOCUMENT_STATUSES.has(document.status));

    return {
      type,
      monthKey,
      required: !OPTIONAL_FOR_MANUAL_CHECK.has(type),
      generated,
      signed,
      status: document?.status ?? 'NOT_GENERATED',
      fileName: document?.fileName
    };
  }
}
