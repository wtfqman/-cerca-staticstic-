import { DocumentType, LegalType } from '@prisma/client';
import mammoth from 'mammoth';

import { DocumentPayloadValidationError } from '../documents/document-payload.validation';
import type { DocxPdfService } from '../services/docx-pdf.service';
import { DocxTemplateRenderService } from '../services/docx-template-render.service';

const renderer = new DocxTemplateRenderService({
  renderPdfFromDocx: async () => Buffer.from('%PDF-smoke%')
} as unknown as DocxPdfService);

const normalizeText = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

const baseCreator = {
  creatorFullName: 'Богданов Фёдор Германович',
  passportSeries: '4523',
  passportNumber: '505094',
  passportIssuedAt: '18.05.2023',
  passportIssuedByInstrumental: 'ГУ МВД РОССИИ ПО Г. МОСКВЕ',
  passportDepartmentCode: '770-029',
  registrationAddress: 'г. Москва ул. Симоновский вал, д.26, к.2, кв. 24',
  inn: '772515371807',
  phone: '89856189220',
  email: 'mieraz.nian@gmail.com',
  bankName: 'АО "ТБанк"',
  bankAccount: '40817810600056161501',
  bankBik: '044525974',
  bankCorrAccount: '30101810145250000974'
};

const payment = {
  rawViews: 814293,
  payableViews: 35040,
  variablePart: 3000,
  fixedSalaryPart: 35040,
  totalPayment: 38040,
  roundedViews: 815000,
  actualVideoCount: 48,
  fixedRatePerVideo: 730,
  fixedSalaryCap: 35040
};

const commonPayload = {
  creator: baseCreator,
  contractNumber: 'БТР-01.03.2026',
  contractDate: '01.03.2026',
  companySignDate: '01.03.2026',
  creatorSignDate: '01.03.2026',
  payment,
  periodStartDate: '01.05.2026',
  periodEndDate: '31.05.2026',
  rawViewsFormatted: '814 293',
  payableViewsFormatted: '35 040',
  variablePartFormatted: '3 000',
  fixedSalaryPartFormatted: '35 040',
  totalPaymentFormatted: '38 040'
};

const validRenderCases: Array<{
  type: DocumentType;
  payload: Record<string, unknown>;
  mustInclude: string[];
  mustNotInclude: string[];
}> = [
  {
    type: DocumentType.CONTRACT,
    payload: {
      ...commonPayload,
      documentDate: '01.03.2026'
    },
    mustInclude: ['БТР-01.03.2026', 'марта 2026'],
    mustNotInclude: ['05.05.2025', '05 мая 2025']
  },
  {
    type: DocumentType.NDA,
    payload: {
      ...commonPayload,
      documentDate: '12.05.2026',
      companySignDate: '12.05.2026',
      creatorSignDate: '12.05.2026'
    },
    mustInclude: ['12 мая 2026'],
    mustNotInclude: ['05.05.2025', '05 мая 2025', '21 мая 2026']
  },
  {
    type: DocumentType.ASSIGNMENT,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '01.05.2026',
      companySignDate: '01.05.2026',
      creatorSignDate: '01.05.2026',
      assignmentDate: '01.05.2026'
    },
    mustInclude: ['БТР-01.03.2026', 'марта 2026', 'мая 2026'],
    mustNotInclude: ['05.05.2025', '05 мая 2025']
  },
  {
    type: DocumentType.ACT,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '31.05.2026',
      companySignDate: '31.05.2026',
      creatorSignDate: '31.05.2026',
      actDate: '31.05.2026'
    },
    mustInclude: ['БТР-01.03.2026', 'марта 2026', 'мая 2026', 'Дата подписи', 'Григорян А.С.', 'Богданов Ф.Г.'],
    mustNotInclude: ['05.05.2025', '05 мая 2025', '___________________/___________________/']
  },
  {
    type: DocumentType.ACT_1000,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '31.05.2026',
      companySignDate: '31.05.2026',
      creatorSignDate: '31.05.2026',
      actDate: '31.05.2026',
      payment: {
        ...payment,
        targetVideoCount: 1,
        baseSalary: 1000,
        fixedRatePerVideo: 1000,
        fixedSalaryCap: 1000,
        actualVideoCount: 1,
        fixedSalaryPart: 1000,
        rawViews: 0,
        roundedViews: 0,
        viewSteps: 0,
        appliedRate: 0,
        variablePart: 0,
        totalPayment: 1000
      },
      rawViewsFormatted: '0',
      variablePartFormatted: '0',
      fixedSalaryPartFormatted: '1 000',
      totalPaymentFormatted: '1 000',
      fixedSalaryWords: 'одна тысяча рублей 00 копеек',
      variablePartWords: 'ноль рублей 00 копеек',
      totalPaymentWords: 'одна тысяча рублей 00 копеек'
    },
    mustInclude: ['БТР-01.03.2026', 'марта 2026', 'мая 2026', '1 000'],
    mustNotInclude: ['05.05.2025', '05 мая 2025', '41 000']
  },
  {
    type: DocumentType.RIGHTS_TRANSFER,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '31.05.2026',
      companySignDate: '31.05.2026',
      creatorSignDate: '31.05.2026',
      rightsTransferDate: '31.05.2026'
    },
    mustInclude: ['БТР-01.03.2026', 'марта 2026', 'мая 2026'],
    mustNotInclude: ['05.05.2025', '05 мая 2025']
  }
];

const invalidCases: Array<{
  title: string;
  type: DocumentType;
  payload: Record<string, unknown>;
  expectedIssueCode: string;
}> = [
  {
    title: 'assignment without contract number',
    type: DocumentType.ASSIGNMENT,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '01.05.2026',
      companySignDate: '01.05.2026',
      creatorSignDate: '01.05.2026',
      assignmentDate: '01.05.2026',
      contractNumber: ''
    },
    expectedIssueCode: 'required_text'
  },
  {
    title: 'NDA with conflicting signature dates',
    type: DocumentType.NDA,
    payload: {
      ...commonPayload,
      documentDate: '12.05.2026',
      companySignDate: '12.05.2026',
      creatorSignDate: '21.05.2026'
    },
    expectedIssueCode: 'conflicting_sign_dates'
  },
  {
    title: 'assignment contract number/date mismatch',
    type: DocumentType.ASSIGNMENT,
    payload: {
      ...commonPayload,
      monthKey: '2026-05',
      documentDate: '01.05.2026',
      companySignDate: '01.05.2026',
      creatorSignDate: '01.05.2026',
      assignmentDate: '01.05.2026',
      contractNumber: 'БТР-01.05.2026'
    },
    expectedIssueCode: 'contract_number_date_mismatch'
  }
];

const renderAndExtractText = async (type: DocumentType, payload: Record<string, unknown>) => {
  const rendered = await renderer.render({
    type,
    legalType: LegalType.SELF_EMPLOYED,
    payload
  });
  const extracted = await mammoth.extractRawText({ buffer: rendered.docxBuffer });

  return normalizeText(extracted.value);
};

const assertValidCases = async () => {
  for (const testCase of validRenderCases) {
    const text = await renderAndExtractText(testCase.type, testCase.payload);

    for (const expected of testCase.mustInclude) {
      if (!text.includes(expected)) {
        throw new Error(`${testCase.type}: rendered text is missing "${expected}"`);
      }
    }

    for (const forbidden of testCase.mustNotInclude) {
      if (text.includes(forbidden)) {
        throw new Error(`${testCase.type}: rendered text still contains "${forbidden}"`);
      }
    }

    console.log(`${testCase.type}: render ok`);
  }
};

const assertInvalidCases = async () => {
  for (const testCase of invalidCases) {
    try {
      await renderer.render({
        type: testCase.type,
        legalType: LegalType.SELF_EMPLOYED,
        payload: testCase.payload
      });
    } catch (error) {
      if (
        error instanceof DocumentPayloadValidationError &&
        error.issues.some((issue) => issue.code === testCase.expectedIssueCode)
      ) {
        console.log(`${testCase.title}: validation ok`);
        continue;
      }

      throw error;
    }

    throw new Error(`${testCase.title}: expected validation error ${testCase.expectedIssueCode}`);
  }
};

const main = async () => {
  await assertValidCases();
  await assertInvalidCases();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
