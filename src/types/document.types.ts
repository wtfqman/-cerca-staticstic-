import type { DocumentStatus, DocumentType, LegalType } from '@prisma/client';

import type { MonthlyAggregationSummary, PaymentCalculationSummary } from './report.types';
import type { DocumentPersonGender, DocumentPersonGrammar } from '../documents/document-person-grammar';

export interface DocumentTemplateDescriptor {
  type: DocumentType;
  legalType: LegalType;
  templatePath: string;
  title: string;
}

export interface CreatorDocumentBasePayload {
  creatorUserId: string;
  creatorFullName: string;
  legalType: LegalType;
  personGender: DocumentPersonGender;
  personGrammar: DocumentPersonGrammar;
  contractStartDate: string;
  contractDeadlineDate: string;
  phone: string;
  email: string;
  inn: string;
  bankName: string;
  bankAccount: string;
  bankBik: string;
  bankCorrAccount: string;
  contractDate?: string;
  contractNumber?: string;
  documentDate?: string;
  companySignDate?: string;
  creatorSignDate?: string;
  passportSeries?: string | null;
  passportNumber?: string | null;
  passportIssuedAt?: string | null;
  passportIssuedByInstrumental?: string | null;
  passportDepartmentCode?: string | null;
  registrationAddress?: string | null;
  ogrnip?: string | null;
  taxSystem?: string | null;
}

export interface MonthlyDocumentPayload extends CreatorDocumentBasePayload {
  monthKey: string;
  periodLabel: string;
  periodStartDate?: string;
  periodEndDate?: string;
  assignmentDate?: string;
  actDate?: string;
  rightsTransferDate?: string;
  aggregation: MonthlyAggregationSummary;
  payment: PaymentCalculationSummary;
  fixedSalaryWords: string;
  variablePartWords: string;
  totalPaymentWords: string;
  fixedRatePerVideoFormatted?: string;
  fixedSalaryCapFormatted?: string;
  servicesBlock: {
    contentUnits: number;
    contentUnitRate?: number;
    contentCap?: number;
    contentCost: number;
    totalViews: number;
    viewsCost: number;
    totalCost: number;
  };
}

export interface GeneratedDocumentResult {
  documentId: string;
  type: DocumentType;
  status: DocumentStatus;
  filePath: string;
  fileName: string;
}
