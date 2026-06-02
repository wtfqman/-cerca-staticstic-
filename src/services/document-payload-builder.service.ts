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

const getMonthStartDate = (monthKey: string) => toDateOnly(getMonthRange(monthKey).dateFrom);

const getMonthEndDate = (monthKey: string) => toDateOnly(getMonthRange(monthKey).dateTo);

const getDefaultOneOffDocumentDate = () => getMonthStartDate(getCurrentMonthKey());

const getDefaultMonthlyDocumentDate = (monthKey: string, type: DocumentType) => {
  if (type === DocumentType.ASSIGNMENT) {
    return getMonthStartDate(monthKey);
  }

  if (type === DocumentType.ACT || type === DocumentType.RIGHTS_TRANSFER) {
    return getMonthEndDate(monthKey);
  }

  return new Date();
};

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
    const workflowContractNumber = resolveWorkflowString(options.workflow, 'contractNumber');
    const documentDate = options.generatedDate ?? workflowContractDate ?? getDefaultOneOffDocumentDate();
    const contractDate = workflowContractDate ?? documentDate;

    return {
      title: type === DocumentType.CONTRACT ? 'Договор' : 'NDA',
      documentType: type,
      generatedDate: formatRussianDate(documentDate),
      documentDate: formatRussianDate(documentDate),
      contractDate: formatRussianDate(contractDate),
      contractNumber: workflowContractNumber ?? buildContractNumber(basePayload.creatorFullName, contractDate),
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
    const workflowContractNumber = resolveWorkflowString(options.workflow, 'contractNumber');
    const documentDate = options.generatedDate ?? getDefaultMonthlyDocumentDate(monthKey, type);
    const monthRange = getMonthRange(monthKey);
    const [aggregation, payment] = await Promise.all([
      this.aggregationService.aggregateCreatorMonth(creatorUserId, monthKey, { submittedOnly: true }),
      this.paymentService.calculateForCreatorMonth(creatorUserId, monthKey, {
        submittedOnly: true,
        persistSnapshot: false
      })
    ]);

    const basePayload = this.buildBasePayload(creator);

    return {
      ...basePayload,
      creator: basePayload,
      title:
        type === DocumentType.ACT
          ? 'Акт'
          : type === DocumentType.ASSIGNMENT
            ? 'Задание'
            : 'Передача прав',
      generatedDate: formatRussianDate(documentDate),
      documentDate: formatRussianDate(documentDate),
      contractDate: workflowContractDate ? formatRussianDate(workflowContractDate) : '',
      contractNumber: workflowContractNumber ?? (
        workflowContractDate ? buildContractNumber(basePayload.creatorFullName, workflowContractDate) : ''
      ),
      assignmentDate: formatRussianDate(documentDate),
      actDate: formatRussianDate(documentDate),
      rightsTransferDate: formatRussianDate(documentDate),
      company: this.getCompanyPayload(),
      workflow: options.workflow,
      monthKey,
      periodLabel: formatMonthLabelRu(monthKey),
      periodStartDate: formatRussianDate(toDateOnly(monthRange.dateFrom)),
      periodEndDate: formatRussianDate(toDateOnly(monthRange.dateTo)),
      aggregation,
      payment,
      fixedSalaryWords: moneyToWordsRu(payment.fixedSalaryPart),
      variablePartWords: moneyToWordsRu(payment.variablePart),
      totalPaymentWords: moneyToWordsRu(payment.totalPayment),
      fixedRatePerVideoFormatted:
        typeof payment.fixedRatePerVideo === 'number' ? formatMoneyRu(payment.fixedRatePerVideo) : '',
      fixedSalaryCapFormatted:
        typeof payment.fixedSalaryCap === 'number' ? formatMoneyRu(payment.fixedSalaryCap) : '',
      servicesBlock: {
        contentUnits: payment.actualVideoCount,
        contentUnitRate: payment.fixedRatePerVideo,
        contentCap: payment.fixedSalaryCap,
        contentCost: payment.fixedSalaryPart,
        totalViews: payment.rawViews,
        viewsCost: payment.variablePart,
        totalCost: payment.totalPayment
      },
      fixedSalaryFormatted: formatMoneyRu(payment.fixedSalaryPart),
      variablePartFormatted: formatMoneyRu(payment.variablePart),
      totalPaymentFormatted: formatMoneyRu(payment.totalPayment),
      roundedViewsFormatted: payment.roundedViews.toLocaleString('ru-RU'),
      rawViewsFormatted: payment.rawViews.toLocaleString('ru-RU')
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
      contractDeadlineDate: profile.contractDeadlineDate ? formatRussianDate(profile.contractDeadlineDate) : '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      inn: profile.inn ?? '',
      bankName: profile.bankName ?? '',
      bankAccount: profile.bankAccount ?? '',
      bankBik: profile.bankBik ?? '',
      bankCorrAccount: profile.bankCorrAccount ?? '',
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
