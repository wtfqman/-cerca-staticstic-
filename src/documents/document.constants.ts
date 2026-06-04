import { DocumentType, LegalType } from '@prisma/client';

import { DOCUMENT_TEMPLATE_ROOT, resolveDocumentTemplate } from './document-template.resolver';

export { DOCUMENT_TEMPLATE_ROOT };

const documentBaseNameMap: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'contract',
  [DocumentType.NDA]: 'nda',
  [DocumentType.ACT]: 'act',
  [DocumentType.ACT_1000]: 'act_1000',
  [DocumentType.ASSIGNMENT]: 'assignment',
  [DocumentType.RIGHTS_TRANSFER]: 'rights_transfer'
};

const documentTitleMap: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'Договор',
  [DocumentType.NDA]: 'NDA',
  [DocumentType.ACT]: 'Акт',
  [DocumentType.ACT_1000]: 'Акт на 1000 руб.',
  [DocumentType.ASSIGNMENT]: 'Задание',
  [DocumentType.RIGHTS_TRANSFER]: 'Передача прав'
};

export const getDocumentTitle = (type: DocumentType): string => documentTitleMap[type];

export const getDocumentBaseName = (type: DocumentType): string => documentBaseNameMap[type];

export const isMonthlyDocument = (type: DocumentType) => {
  switch (type) {
    case DocumentType.ACT:
    case DocumentType.ACT_1000:
    case DocumentType.ASSIGNMENT:
    case DocumentType.RIGHTS_TRANSFER:
      return true;
    default:
      return false;
  }
};

export const getDocumentScopeKey = (type: DocumentType, monthKey?: string) => {
  if (isMonthlyDocument(type)) {
    if (!monthKey) {
      throw new Error('Для ежемесячного документа нужен monthKey');
    }

    return monthKey;
  }

  return 'permanent';
};

export const getTemplatePath = (type: DocumentType, legalType: LegalType): string =>
  resolveDocumentTemplate({ type, legalType }).templatePath;
