import { LegalType } from '@prisma/client';

import { CreatorProfileRepository, type CreatorProfileUpsertInput } from '../repositories/creator-profile.repository';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { UserRepository } from '../repositories/user.repository';
import type { AppUser } from '../types/domain';
import { formatPassportSeriesNumber, formatRussianDate } from '../utils/formatters';
import { CREATOR_SELF_EDIT_DISABLED_TEXT } from '../texts/messages';
import { canUseAdminScenario, canUseCreatorScenario, canUseTeamLeadScenario } from '../utils/access';
import { isNoContractLegalType } from '../utils/creator-registration-mode';

export type CreatorProfileEditableField =
  | 'fullName'
  | 'contractDeadlineDate'
  | 'passportSeries'
  | 'passportNumber'
  | 'passportIssuedAt'
  | 'passportIssuedByInstrumental'
  | 'passportDepartmentCode'
  | 'registrationAddress'
  | 'inn'
  | 'ogrnip'
  | 'bankAccount'
  | 'bankName'
  | 'bankBik'
  | 'bankCorrAccount'
  | 'phone'
  | 'email';

export const creatorProfileFieldLabels: Record<CreatorProfileEditableField, string> = {
  fullName: 'ФИО',
  contractDeadlineDate: 'Срок выполнения договора',
  passportSeries: 'Серия паспорта',
  passportNumber: 'Номер паспорта',
  passportIssuedAt: 'Дата выдачи паспорта',
  passportIssuedByInstrumental: 'Кем выдан паспорт',
  passportDepartmentCode: 'Код подразделения паспорта',
  registrationAddress: 'Адрес регистрации',
  inn: 'ИНН',
  ogrnip: 'ОГРНИП',
  bankAccount: 'Расчетный счет',
  bankName: 'Название банка',
  bankBik: 'БИК',
  bankCorrAccount: 'Корреспондентский счет',
  phone: 'Телефон',
  email: 'Email'
};

const selfEmployedEditableFields: CreatorProfileEditableField[] = [
  'fullName',
  'contractDeadlineDate',
  'passportSeries',
  'passportNumber',
  'passportIssuedAt',
  'passportIssuedByInstrumental',
  'passportDepartmentCode',
  'registrationAddress',
  'inn',
  'bankAccount',
  'bankName',
  'bankBik',
  'bankCorrAccount',
  'phone',
  'email'
];

const ipEditableFields: CreatorProfileEditableField[] = [
  'fullName',
  'contractDeadlineDate',
  'registrationAddress',
  'inn',
  'ogrnip',
  'bankAccount',
  'bankName',
  'bankBik',
  'bankCorrAccount',
  'phone',
  'email'
];

const noContractEditableFields: CreatorProfileEditableField[] = [
  'fullName',
  'phone',
  'email'
];

export const getCreatorProfileEditableFields = (legalType?: LegalType | null): CreatorProfileEditableField[] => {
  if (isNoContractLegalType(legalType)) {
    return noContractEditableFields;
  }

  if (legalType === LegalType.SELF_EMPLOYED) {
    return selfEmployedEditableFields;
  }

  if (legalType === LegalType.IP) {
    return ipEditableFields;
  }

  return [];
};

const isDateField = (field: CreatorProfileEditableField) =>
  field === 'contractDeadlineDate' || field === 'passportIssuedAt';

const hasValue = (value: unknown) => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return value !== null && value !== undefined;
};

const formatAuditValue = (value: unknown): string | null => {
  if (!hasValue(value)) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value);
};

const formatDisplayValue = (value: unknown): string => {
  if (!hasValue(value)) {
    return '—';
  }

  if (value instanceof Date) {
    return formatRussianDate(value);
  }

  return String(value);
};

export class CreatorProfileService {
  constructor(
    private readonly repository: CreatorProfileRepository,
    private readonly userRepository: UserRepository,
    private readonly teamLeadRepository: TeamLeadRepository
  ) {}

  getProfile(userId: string) {
    return this.repository.findByUserId(userId);
  }

  async saveDraft(userId: string, input: CreatorProfileUpsertInput) {
    return this.repository.upsertProfile(userId, {
      ...input,
      profileCompleted: false
    });
  }

  async completeProfile(userId: string, input: CreatorProfileUpsertInput & { legalType?: LegalType | null }) {
    this.ensureCompleteProfile(input);

    return this.repository.upsertProfile(userId, {
      ...input,
      profileCompleted: true
    });
  }

  async getManageableCreatorProfile(actor: AppUser, creatorUserId: string) {
    await this.assertCanManageCreatorProfile(actor, creatorUserId);

    const creator = await this.userRepository.findById(creatorUserId);

    if (!creator || !canUseCreatorScenario(creator)) {
      throw new Error('Креатор не найден');
    }

    if (!creator.creatorProfile) {
      throw new Error('Анкета креатора пока не создана');
    }

    if (!creator.creatorProfile.profileCompleted) {
      throw new Error('Анкета креатора еще не завершена. Редактирование доступно после первичной регистрации.');
    }

    return creator;
  }

  async updateRegistrationField(
    actor: AppUser,
    creatorUserId: string,
    field: CreatorProfileEditableField,
    value: string | Date
  ) {
    const creator = await this.getManageableCreatorProfile(actor, creatorUserId);
    const profile = creator.creatorProfile;

    if (!profile) {
      throw new Error('Анкета креатора пока не создана');
    }

    const availableFields = getCreatorProfileEditableFields(profile.legalType);

    if (!availableFields.includes(field)) {
      throw new Error('Это поле недоступно для типа анкеты креатора');
    }

    const data = { [field]: value } as CreatorProfileUpsertInput;
    const oldValue = formatAuditValue(profile[field]);
    const newValue = formatAuditValue(value);

    return this.repository.updateProfileFieldsWithAudit({
      creatorUserId,
      actorUserId: actor.id,
      field,
      data,
      oldValue,
      newValue
    });
  }

  formatFieldValue(field: CreatorProfileEditableField, value: unknown) {
    return isDateField(field) ? formatRussianDate(value as Date | string | null | undefined) : formatDisplayValue(value);
  }

  formatProfileSummary(profile: Awaited<ReturnType<CreatorProfileService['getProfile']>>) {
    if (!profile) {
      return 'Анкета пока не заполнена.';
    }

    const legalTypeLabel = isNoContractLegalType(profile.legalType)
      ? 'Без договора'
      : profile.legalType === LegalType.IP
        ? 'ИП'
        : 'Самозанятый / СЗ';
    const passport = formatPassportSeriesNumber(profile.passportSeries, profile.passportNumber);

    return [
      `Тип: ${legalTypeLabel}`,
      `ФИО: ${profile.fullName ?? '—'}`,
      isNoContractLegalType(profile.legalType)
        ? null
        : `Срок выполнения договора: ${formatRussianDate(profile.contractDeadlineDate)}`,
      profile.legalType === LegalType.SELF_EMPLOYED
        ? `Паспорт: ${passport}`
        : null,
      profile.legalType === LegalType.SELF_EMPLOYED
        ? `Дата выдачи паспорта: ${formatRussianDate(profile.passportIssuedAt)}`
        : null,
      profile.legalType === LegalType.SELF_EMPLOYED
        ? `Кем выдан паспорт: ${profile.passportIssuedByInstrumental ?? '—'}`
        : null,
      profile.legalType === LegalType.SELF_EMPLOYED
        ? `Код подразделения: ${profile.passportDepartmentCode ?? '—'}`
        : null,
      isNoContractLegalType(profile.legalType) ? null : `Адрес регистрации: ${profile.registrationAddress ?? '—'}`,
      isNoContractLegalType(profile.legalType) ? null : `ИНН: ${profile.inn ?? '—'}`,
      profile.legalType === LegalType.IP ? `ОГРНИП: ${profile.ogrnip ?? '—'}` : null,
      isNoContractLegalType(profile.legalType) ? null : `Расчетный счет: ${profile.bankAccount ?? '—'}`,
      isNoContractLegalType(profile.legalType) ? null : `Банк: ${profile.bankName ?? '—'}`,
      isNoContractLegalType(profile.legalType) ? null : `БИК: ${profile.bankBik ?? '—'}`,
      isNoContractLegalType(profile.legalType) ? null : `Корр. счет: ${profile.bankCorrAccount ?? '—'}`,
      `Телефон: ${profile.phone ?? '—'}`,
      `Email: ${profile.email ?? '—'}`
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async assertCanManageCreatorProfile(actor: AppUser, creatorUserId: string) {
    if (canUseAdminScenario(actor)) {
      return;
    }

    if (actor.id === creatorUserId) {
      throw new Error(CREATOR_SELF_EDIT_DISABLED_TEXT);
    }

    if (!canUseTeamLeadScenario(actor)) {
      throw new Error('Редактирование анкеты доступно только администратору или тимлиду креатора.');
    }

    const link = await this.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId);

    if (!link || link.teamLeadUserId !== actor.id) {
      throw new Error('У тебя нет доступа к редактированию этого креатора.');
    }
  }

  private ensureCompleteProfile(input: CreatorProfileUpsertInput & { legalType?: LegalType | null }) {
    if (input.legalType === undefined) {
      throw new Error('Выбери тип регистрации.');
    }

    const requiredFields = isNoContractLegalType(input.legalType)
      ? noContractEditableFields
      : input.legalType === LegalType.IP
        ? ipEditableFields
        : selfEmployedEditableFields;
    const missingField = requiredFields.find((field) => !hasValue(input[field]));

    if (missingField) {
      throw new Error(`Анкета заполнена не полностью. Не заполнено поле: ${creatorProfileFieldLabels[missingField]}.`);
    }
  }
}
