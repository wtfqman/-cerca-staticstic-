import { DocumentRepository } from '../repositories/document.repository';
import { isCurrentDocumentWorkflowScopeKey } from '../documents/document-workflow.constants';
import { formatAssignedTeamLeadName, formatCreatorDisplayName, formatRussianDateTime } from '../utils/formatters';
import { GoogleSheetsService, type SheetUpsertResult } from './google-sheets.service';
import { SpreadsheetFormatterService } from './spreadsheet-formatter.service';

export interface DocumentsSheetSyncFilters {
  creatorUserId?: string;
  creatorIds?: string[];
  monthKey?: string;
  documentIds?: string[];
}

export class DocumentsSheetSyncService {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly formatter: SpreadsheetFormatterService
  ) {}

  async prepareSheet() {
    await this.googleSheetsService.ensureSheet(this.formatter.getDocumentsSheetDefinition());
  }

  async sync(filters: DocumentsSheetSyncFilters = {}): Promise<SheetUpsertResult> {
    const documents = await this.documentRepository.listForSheetSync(filters);

    return this.googleSheetsService.upsertRows(
      this.formatter.getDocumentsSheetDefinition(),
      documents.filter((document) => isCurrentDocumentWorkflowScopeKey(document.scopeKey)).map((document) =>
        this.formatter.buildDocumentsRow({
          documentId: document.id,
          creatorUserId: document.creatorUserId,
          creatorName: formatCreatorDisplayName(document.creator),
          teamLeadName: formatAssignedTeamLeadName(document.creator),
          documentType: document.type,
          legalType: document.legalType,
          scopeKey: document.scopeKey,
          monthKey: document.monthKey ?? '',
          status: document.status,
          fileName: document.fileName,
          generatedAt: formatRussianDateTime(document.generatedAt),
          sentAt: formatRussianDateTime(document.sentAt),
          signedUploadedAt: formatRussianDateTime(document.signedUploadedAt),
          forwardedAt: formatRussianDateTime(document.forwardedAt),
          updatedAt: formatRussianDateTime(document.updatedAt)
        })
      )
    );
  }

  async rebuild(): Promise<SheetUpsertResult> {
    const documents = await this.documentRepository.listForSheetSync();

    return this.googleSheetsService.rebuildSheet(
      this.formatter.getDocumentsSheetDefinition(),
      documents.filter((document) => isCurrentDocumentWorkflowScopeKey(document.scopeKey)).map((document) =>
        this.formatter.buildDocumentsRow({
          documentId: document.id,
          creatorUserId: document.creatorUserId,
          creatorName: formatCreatorDisplayName(document.creator),
          teamLeadName: formatAssignedTeamLeadName(document.creator),
          documentType: document.type,
          legalType: document.legalType,
          scopeKey: document.scopeKey,
          monthKey: document.monthKey ?? '',
          status: document.status,
          fileName: document.fileName,
          generatedAt: formatRussianDateTime(document.generatedAt),
          sentAt: formatRussianDateTime(document.sentAt),
          signedUploadedAt: formatRussianDateTime(document.signedUploadedAt),
          forwardedAt: formatRussianDateTime(document.forwardedAt),
          updatedAt: formatRussianDateTime(document.updatedAt)
        })
      )
    );
  }
}
