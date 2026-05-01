import { DocumentType } from '@prisma/client';

const CURRENT_LAYOUT_REVISIONS: Partial<Record<DocumentType, number>> = {
  [DocumentType.NDA]: 1,
  [DocumentType.ASSIGNMENT]: 1
};

export const getCurrentDocumentLayoutRevision = (type: DocumentType) =>
  CURRENT_LAYOUT_REVISIONS[type] ?? null;
