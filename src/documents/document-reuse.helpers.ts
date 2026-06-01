import { DocumentStatus, DocumentType } from '@prisma/client';

import { isCurrentDocumentWorkflowScopeKey } from './document-workflow.constants';

export const PERMANENT_SIGNATURE_DOCUMENT_TYPES = [
  DocumentType.CONTRACT,
  DocumentType.NDA
] as const;

const permanentSignatureDocumentTypes = new Set<DocumentType>(PERMANENT_SIGNATURE_DOCUMENT_TYPES);

export const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

export const isPermanentSignatureDocumentType = (type?: DocumentType | null) =>
  Boolean(type && permanentSignatureDocumentTypes.has(type));

export const isSignedDocumentStatus = (status: DocumentStatus) =>
  SIGNED_DOCUMENT_STATUSES.has(status);

export const isCurrentOrPermanentSignatureDocument = (document: {
  scopeKey?: string | null;
  type?: DocumentType | null;
}) =>
  isPermanentSignatureDocumentType(document.type) || isCurrentDocumentWorkflowScopeKey(document.scopeKey);
