import path from 'node:path';

import { DocumentType, LegalType } from '@prisma/client';

export const DOCX_DOCUMENT_TEMPLATE_ROOT = path.resolve(
  process.cwd(),
  'src',
  'templates',
  'documents-docx'
);

const DOCX_TEMPLATE_FILE_NAME = 'template.docx';

type DocxSection = {
  startAfterMarker?: string;
  startAfterMarkers?: string[];
  startMarker: string;
  endAfterMarker?: string;
  endMarker?: string;
  endMarkerOptional?: boolean;
  forbiddenExactBlockTexts?: string[];
  forbiddenMarkers?: string[];
};

const legalTypeFolderMap: Record<LegalType, string> = {
  [LegalType.SELF_EMPLOYED]: 'self-employed',
  [LegalType.IP]: 'ip'
};

const documentFolderMap: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'contract',
  [DocumentType.NDA]: 'nda',
  [DocumentType.ACT]: 'contract',
  [DocumentType.ACT_1000]: 'contract',
  [DocumentType.ASSIGNMENT]: 'contract',
  [DocumentType.RIGHTS_TRANSFER]: 'contract'
};

const documentSectionMap: Partial<Record<DocumentType, DocxSection>> = {
  [DocumentType.CONTRACT]: {
    startMarker: 'ДОГОВОР №',
    endAfterMarker: 'почта@gmail.com',
    endMarker: 'Приложение №1',
    forbiddenExactBlockTexts: ['Приложение №1'],
    forbiddenMarkers: ['Задание заказчика №']
  },
  [DocumentType.ASSIGNMENT]: {
    startAfterMarker: 'почта@gmail.com',
    startMarker: 'Приложение №1',
    endMarker: 'Приложение №2'
  },
  [DocumentType.ACT]: {
    startAfterMarker: 'Задание заказчика №_',
    startMarker: 'Приложение №2',
    endMarker: 'Приложение №3'
  },
  [DocumentType.ACT_1000]: {
    startAfterMarker: 'Общая стоимость оказанных услуг составляет',
    startMarker: 'Приложение №3',
    endMarker: 'Приложение №4',
    endMarkerOptional: true
  },
  [DocumentType.RIGHTS_TRANSFER]: {
    startAfterMarker: 'Общая стоимость оказанных услуг составляет',
    startMarker: 'Приложение №3',
    endMarker: 'Приложение №4',
    endMarkerOptional: true
  }
};

const legalPackageStartMarkerMap: Partial<Record<LegalType, string>> = {
  [LegalType.IP]: 'Вкладка 2'
};

const withLegalPackageStart = (legalType: LegalType, section?: DocxSection): DocxSection | undefined => {
  if (!section) {
    return undefined;
  }

  const packageStartMarker = legalPackageStartMarkerMap[legalType];

  if (!packageStartMarker) {
    return section;
  }

  return {
    ...section,
    startAfterMarkers: [
      packageStartMarker,
      ...(
        section.startAfterMarkers ??
        (section.startAfterMarker ? [section.startAfterMarker] : [])
      )
    ],
    startAfterMarker: undefined
  };
};

export interface ResolvedDocxDocumentTemplate {
  type: DocumentType;
  legalType: LegalType;
  templatePath: string;
  relativePath: string;
  section?: DocxSection;
}

export const resolveDocxDocumentTemplate = (input: {
  type: DocumentType;
  legalType: LegalType;
}): ResolvedDocxDocumentTemplate => {
  const documentFolder = documentFolderMap[input.type];
  const legalTypeFolder = legalTypeFolderMap[input.legalType];
  const relativePath = path.join(documentFolder, legalTypeFolder, DOCX_TEMPLATE_FILE_NAME);

  return {
    type: input.type,
    legalType: input.legalType,
    templatePath: path.join(DOCX_DOCUMENT_TEMPLATE_ROOT, relativePath),
    relativePath,
    section: withLegalPackageStart(input.legalType, documentSectionMap[input.type])
  };
};
