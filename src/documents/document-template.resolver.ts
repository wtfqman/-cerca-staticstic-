import path from 'node:path';

import { DocumentType, LegalType } from '@prisma/client';

export const DOCUMENT_TEMPLATE_ROOT = path.resolve(process.cwd(), 'src', 'templates', 'documents');
export const DOCUMENT_TEMPLATE_FILE_NAME = 'template.hbs';

const documentFolderMap: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'contract',
  [DocumentType.NDA]: 'nda',
  [DocumentType.ACT]: 'act',
  [DocumentType.ACT_1000]: 'act',
  [DocumentType.ASSIGNMENT]: 'assignment',
  [DocumentType.RIGHTS_TRANSFER]: 'rights-transfer'
};

const legalTypeFolderMap: Record<LegalType, string> = {
  [LegalType.SELF_EMPLOYED]: 'self-employed',
  [LegalType.IP]: 'ip'
};

const monthlyDocumentTypes = new Set<DocumentType>([
  DocumentType.ACT,
  DocumentType.ACT_1000,
  DocumentType.ASSIGNMENT,
  DocumentType.RIGHTS_TRANSFER
]);

export interface DocumentTemplateLookupInput {
  type: DocumentType;
  legalType: LegalType;
  monthKey?: string;
}

export interface ResolvedDocumentTemplate {
  type: DocumentType;
  legalType: LegalType;
  monthKey?: string;
  isMonthly: boolean;
  templatePath: string;
  relativePath: string;
}

export const resolveDocumentTemplate = (
  input: DocumentTemplateLookupInput
): ResolvedDocumentTemplate => {
  const documentFolder = documentFolderMap[input.type];
  const legalTypeFolder = legalTypeFolderMap[input.legalType];
  const relativePath = path.join(
    documentFolder,
    legalTypeFolder,
    DOCUMENT_TEMPLATE_FILE_NAME
  );

  return {
    type: input.type,
    legalType: input.legalType,
    monthKey: input.monthKey,
    isMonthly: monthlyDocumentTypes.has(input.type),
    templatePath: path.join(DOCUMENT_TEMPLATE_ROOT, relativePath),
    relativePath
  };
};
