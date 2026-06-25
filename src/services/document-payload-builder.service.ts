import { DocumentType, LegalType } from '@prisma/client';

import type { CreatorDocumentBasePayload, MonthlyDocumentPayload } from '../types/document.types';
import { config } from '../config';
import { UserRepository } from '../repositories/user.repository';
import { MonthlyAggregationService } from './monthly-aggregation.service';
import { PaymentCalculationService } from './payment-calculation.service';
import { formatMonthLabelRu, formatMoneyRu, formatPassportSeriesNumber, formatRussianDate } from '../utils/formatters';
import { moneyToWordsRu } from '../utils/money-words';
import { getCurrentMonthKey, getMonthRange, toDateOnly } from '../utils/periods';
import { resolveDocumentPersonGrammar } from '../documents/document-person-grammar';
import { assertCreatorDocumentProfileValid } from '../documents/document-payload.validation';

const buildCreatorInitials = (fullName: string) => {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[^A-Za-zА-Яа-яЁё]+/, ''))
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0].toLocaleUpperCase('ru-RU'))
    .join('');

  return initials || 'БН';
};

const buildContractNumber = (fullName: string, contractDate: Date) =>
  `${buildCreatorInitials(fullName)}-${formatRussianDate(contractDate)}`;

const resolveWorkflowDate = (workflow: Record<string, unknown> | undefined, key: string) => {
  const value = workflow?.[key];

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveWorkflowString = (workflow: Record<string, unknown> | undefined, key: string) => {
  const value = workflow?.[key];

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
};

const hasText = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0;
const ACT_1000_AMOUNT = 1_000;

const getMonthStartDate = (monthKey: string) => toDateOnly(getMonthRange(monthKey).dateFrom);

const getMonthEndDate = (monthKey: string) => toDateOnly(getMonthRange(monthKey).dateTo);

const getDefaultOneOffDocumentDate = () => getMonthStartDate(getCurrentMonthKey());

const getDefaultMonthlyDocumentDate = (monthKey: string, type: DocumentType) => {
  if (type === DocumentType.ASSIGNMENT) {
    return getMonthStartDate(monthKey);
  }

  if (type === DocumentType.ACT || type === DocumentType.ACT_1000 || type === DocumentType.RIGHTS_TRANSFER) {
    return getMonthEndDate(monthKey);
  }

  return new Date();
};

const buildAct1000Payment = <T extends {
  targetVideoCount: number;
  baseSalary: number;
  fixedRatePerVideo?: number;
  fixedSalaryCap?: number;
  actualVideoCount: number;
  fixedSalaryPart: number;
  rawViews: number;
  roundedViews: number;
  viewSteps: number;
  appliedRate: number;
  variablePart: number;
  totalPayment: number;
}>(payment: T): T => ({
  ...payment,
  targetVideoCount: 1,
  baseSalary: ACT_1000_AMOUNT,
  fixedRatePerVideo: ACT_1000_AMOUNT,
  fixedSalaryCap: ACT_1000_AMOUNT,
  actualVideoCount: 1,
  fixedSalaryPart: ACT_1000_AMOUNT,
  rawViews: 0,
  roundedViews: 0,
  viewSteps: 0,
  appliedRate: 0,
  variablePart: 0,
  totalPayment: ACT_1000_AMOUNT
});

const resolveWorkflowSignDate = (
  workflow: Record<string, unknown> | undefined,
  key: string,
  fallback: Date
) => resolveWorkflowDate(workflow, key) ?? fallback;

export class DocumentPayloadBuilderService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly aggregationService: MonthlyAggregationService,
    private readonly paymentService: PaymentCalculationService
  ) {}

  async assertCreatorProfileCompleted(creatorUserId: string) {
    const creator = await this.userRepository.findById(creatorUserId);

    if (!creator?.creatorProfile || !creator.creatorProfile.profileCompleted || !creator.creatorProfile.legalType) {
      throw new Error('Профиль креатора не найден или не завершен');
    }

    if (
      creator.creatorProfile.legalType === LegalType.SELF_EMPLOYED &&
      !hasText(creator.creatorProfile.passportDepartmentCode)
    ) {
      throw new Error(
        'В анкете не заполнен код подразделения паспорта. Заполни это поле в анкете, затем сформируй документы еще раз.'
      );
    }

    assertCreatorDocumentProfileValid(creator.creatorProfile);

    return creator;
  }

  async buildOneOffPayload(
    creatorUserId: string,
    type: DocumentType,
    options: { generatedDate?: Date; workflow?: Record<string, unknown> } = {}
  ) {
    const creator = await this.assertCreatorProfileCompleted(creatorUserId);

    const basePayload = this.buildBasePayload(creator);
    const workflowContractDate = resolveWorkflowDate(options.workflow, 'contractDate');
    const workflowDocumentDate = resolveWorkflowDate(options.workflow, 'documentDate');
    const workflowContractNumber = resolveWorkflowString(options.workflow, 'contractNumber');
    const profileContractDate = creator.creatorProfile!.contractStartDate ?? null;
    const documentDate = workflowDocumentDate ??
      options.generatedDate ??
      workflowContractDate ??
      profileContractDate ??
      getDefaultOneOffDocumentDate();
    const contractDate = workflowContractDate ?? profileContractDate ?? documentDate;
    const companySignDate = resolveWorkflowSignDate(options.workflow, 'companySignDate', documentDate);
    const creatorSignDate = resolveWorkflowSignDate(options.workflow, 'creatorSignDate', documentDate);

    return {
      title: type === DocumentType.CONTRACT ? 'Договор' : 'NDA',
      documentType: type,
      generatedDate: formatRussianDate(documentDate),
      documentDate: formatRussianDate(documentDate),
      contractDate: formatRussianDate(contractDate),
      contractNumber: workflowContractNumber ?? buildContractNumber(basePayload.creatorFullName, contractDate),
      companySignDate: formatRussianDate(companySignDate),
      creatorSignDate: formatRussianDate(creatorSignDate),
      creator: basePayload,
      company: this.getCompanyPayload(),
      workflow: options.workflow,
      passportCombined: formatPassportSeriesNumber(
        basePayload.passportSeries,
        basePayload.passportNumber
      )
    };
  }

  async buildMonthlyPayload(
    creatorUserId: string,
    monthKey: string,
    type: DocumentType,
    options: { generatedDate?: Date; workflow?: Record<string, unknown> } = {}
  ): Promise<MonthlyDocumentPayload & Record<string, unknown>> {
    const creator = await this.assertCreatorProfileCompleted(creatorUserId);

    const workflowContractDate = resolveWorkflowDate(options.workflow, 'contractDate');
    const workflowDocumentDate = resolveWorkflowDate(options.workflow, 'documentDate');
    const workflowContractNumber = resolveWorkflowString(options.workflow, 'contractNumber');
    const documentDate = workflowDocumentDate ?? options.generatedDate ?? getDefaultMonthlyDocumentDate(monthKey, type);
    const companySignDate = resolveWorkflowSignDate(options.workflow, 'companySignDate', documentDate);
    const creatorSignDate = resolveWorkflowSignDate(options.workflow, 'creatorSignDate', documentDate);
    const monthRange = getMonthRange(monthKey);
    const [aggregation, payment] = await Promise.all([
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey, { submittedOnly: true }),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey, {
        submittedOnly: true,
        persistSnapshot: false
      })
    ]);

    const basePayload = this.buildBasePayload(creator);
    const documentPayment = type === DocumentType.ACT_1000 ? buildAct1000Payment(payment) : payment;

    return {
      ...basePayload,
      creator: basePayload,
      title:
        type === DocumentType.ACT
          ? 'Акт'
          : type === DocumentType.ACT_1000
            ? 'Акт передачи прав на 1000 руб.'
            : type === DocumentType.ASSIGNMENT
            ? 'Задание'
            : 'Передача прав',
      generatedDate: formatRussianDate(documentDate),
      documentDate: formatRussianDate(documentDate),
      contractDate: workflowContractDate ? formatRussianDate(workflowContractDate) : '',
      contractNumber: workflowContractNumber ?? (
        workflowContractDate ? buildContractNumber(basePayload.creatorFullName, workflowContractDate) : ''
      ),
      companySignDate: formatRussianDate(companySignDate),
      creatorSignDate: formatRussianDate(creatorSignDate),
      assignmentDate: type === DocumentType.ASSIGNMENT ? formatRussianDate(documentDate) : '',
      actDate: type === DocumentType.ACT ? formatRussianDate(documentDate) : '',
      rightsTransferDate:
        type === DocumentType.ACT_1000 || type === DocumentType.RIGHTS_TRANSFER
          ? formatRussianDate(documentDate)
          : '',
      company: this.getCompanyPayload(),
      workflow: options.workflow,
      monthKey,
      periodLabel: formatMonthLabelRu(monthKey),
      periodStartDate: formatRussianDate(toDateOnly(monthRange.dateFrom)),
      periodEndDate: formatRussianDate(toDateOnly(monthRange.dateTo)),
      aggregation,
      payment: documentPayment,
      fixedSalaryWords: moneyToWordsRu(documentPayment.fixedSalaryPart),
      variablePartWords: moneyToWordsRu(documentPayment.variablePart),
      totalPaymentWords: moneyToWordsRu(documentPayment.totalPayment),
      fixedRatePerVideoFormatted:
        typeof documentPayment.fixedRatePerVideo === 'number' ? formatMoneyRu(documentPayment.fixedRatePerVideo) : '',
      fixedSalaryCapFormatted:
        typeof documentPayment.fixedSalaryCap === 'number' ? formatMoneyRu(documentPayment.fixedSalaryCap) : '',
      servicesBlock: {
        contentUnits: documentPayment.actualVideoCount,
        contentUnitRate: documentPayment.fixedRatePerVideo,
        contentCap: documentPayment.fixedSalaryCap,
        contentCost: documentPayment.fixedSalaryPart,
        totalViews: documentPayment.rawViews,
        viewsCost: documentPayment.variablePart,
        totalCost: documentPayment.totalPayment
      },
      fixedSalaryFormatted: formatMoneyRu(documentPayment.fixedSalaryPart),
      variablePartFormatted: formatMoneyRu(documentPayment.variablePart),
      totalPaymentFormatted: formatMoneyRu(documentPayment.totalPayment),
      roundedViewsFormatted: documentPayment.roundedViews.toLocaleString('ru-RU'),
      rawViewsFormatted: documentPayment.rawViews.toLocaleString('ru-RU')
    };
  }

  private buildBasePayload(creator: NonNullable<Awaited<ReturnType<UserRepository['findById']>>>): CreatorDocumentBasePayload & Record<string, unknown> {
    const profile = creator.creatorProfile;

    if (!profile?.legalType) {
      throw new Error('У креатора не указан legalType');
    }

    const creatorFullName = profile.fullName ?? '';
    const personGrammar = resolveDocumentPersonGrammar({
      fullName: creatorFullName
    });

    return {
      creatorUserId: creator.id,
      creatorFullName,
      legalType: profile.legalType,
      personGender: personGrammar.gender,
      personGrammar,
      creatorLegalLabel: profile.legalType === LegalType.SELF_EMPLOYED ? personGrammar.selfEmployedLegalLabel : 'ИП',
      contractStartDate: profile.contractStartDate ? formatRussianDate(profile.contractStartDate) : '',
      contractDeadlineDate: profile.contractDeadlineDate ? formatRussianDate(profile.contractDeadlineDate) : '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      inn: profile.inn ?? '',
      bankName: profile.bankName ?? '',
      bankAccount: profile.bankAccount ?? '',
      bankBik: profile.bankBik ?? '',
      bankCorrAccount: profile.bankCorrAccount ?? '',
      taxSystem: profile.taxSystem ?? null,
      passportSeries: profile.passportSeries,
      passportNumber: profile.passportNumber,
      passportIssuedAt: profile.passportIssuedAt ? formatRussianDate(profile.passportIssuedAt) : null,
      passportIssuedByInstrumental: profile.passportIssuedByInstrumental,
      passportDepartmentCode: profile.passportDepartmentCode,
      registrationAddress: profile.registrationAddress,
      ogrnip: profile.ogrnip
    };
  }

  private getCompanyPayload() {
    return {
      name: config.documents.company.name,
      shortName: config.documents.company.shortName,
      representative: config.documents.company.representative,
      representativeBasis: config.documents.company.representativeBasis,
      address: config.documents.company.address,
      inn: config.documents.company.inn,
      bankName: config.documents.company.bankName,
      bankAccount: config.documents.company.bankAccount,
      bankBik: config.documents.company.bankBik,
      bankCorrAccount: config.documents.company.bankCorrAccount,
      email: config.documents.company.email
    };
  }
}
