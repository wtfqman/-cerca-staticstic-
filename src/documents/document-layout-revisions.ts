import { DocumentType } from '@prisma/client';

const CURRENT_LAYOUT_REVISIONS: Partial<Record<DocumentType, number>> = {
  [DocumentType.NDA]: 2,
  [DocumentType.ASSIGNMENT]: 2,
  [DocumentType.ACT]: 2,
  [DocumentType.ACT_1000]: 2,
  [DocumentType.RIGHTS_TRANSFER]: 1
};

export const getCurrentDocumentLayoutRevision = (type: DocumentType) =>
  CURRENT_LAYOUT_REVISIONS[type] ?? null;
