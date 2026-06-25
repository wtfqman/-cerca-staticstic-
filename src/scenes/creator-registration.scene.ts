import { LegalType } from '@prisma/client';
import { Markup, Scenes } from 'telegraf';

import { container } from '../container';
import { cancelSceneKeyboard } from '../keyboards/menu.keyboards';
import { confirmInlineKeyboard, legalTypeInlineKeyboard } from '../keyboards/inline.keyboards';
import { SCENE_IDS } from './scene-ids';
import type { BotContext } from '../types/bot-context';
import {
  bankAccountSchema,
  bankBikSchema,
  bankCorrAccountSchema,
  bankNameSchema,
  emailSchema,
  fullNameSchema,
  innSchema,
  legalTypeSchema,
  ogrnipSchema,
  parseRuDateToDate,
  passportDepartmentCodeSchema,
  passportIssuedByInstrumentalSchema,
  passportNumberSchema,
  passportSeriesSchema,
  phoneSchema,
  registrationAddressSchema,
  taxSystemSchema
} from '../validators/profile.schemas';
import { getMessageText } from '../utils/telegram';
import { formatRussianDate } from '../utils/formatters';
import type { CreatorProfileUpsertInput } from '../repositories/creator-profile.repository';
import { formatUserError, formatValidationError, logUserError } from '../utils/user-errors';
import { startCreatorDocumentsAfterRegistration } from '../creators/creator-documents.flow';
import { CONTRACT_DEADLINE_REGISTRATION_PROMPT, CONTRACT_START_DATE_REGISTRATION_PROMPT } from '../texts/messages';
import { NO_CONTRACT_REGISTRATION_VALUE, isNoContractLegalType } from '../utils/creator-registration-mode';
import { safeAnswerCbQuery } from '../utils/telegram-callback';

type RegistrationField =
  | 'fullName'
  | 'contractStartDate'
  | 'contractDeadlineDate'
  | 'passportSeries'
  | 'passportNumber'
  | 'passportIssuedAt'
  | 'passportIssuedByInstrumental'
  | 'passportDepartmentCode'
  | 'registrationAddress'
  | 'inn'
  | 'ogrnip'
  | 'taxSystem'
  | 'bankAccount'
  | 'bankName'
  | 'bankBik'
  | 'bankCorrAccount'
  | 'phone'
  | 'email';

type RegistrationDraft = CreatorProfileUpsertInput;

type RegistrationState = {
  draft: RegistrationDraft;
  fieldIndex: number;
};

type ExistingCreatorProfile = NonNullable<NonNullable<BotContext['state']['currentUser']>['creatorProfile']>;

type FieldConfig = {
  key: RegistrationField;
  prompt: string;
  parse: (value: string) => string | Date;
};

const fieldConfigs: Record<RegistrationField, FieldConfig> = {
  fullName: {
    key: 'fullName',
    prompt: 'Укажи ФИО полностью.',
    parse: (value) => fullNameSchema.parse(value)
  },
  contractStartDate: {
    key: 'contractStartDate',
    prompt: CONTRACT_START_DATE_REGISTRATION_PROMPT,
    parse: parseRuDateToDate
  },
  contractDeadlineDate: {
    key: 'contractDeadlineDate',
    prompt: CONTRACT_DEADLINE_REGISTRATION_PROMPT,
    parse: parseRuDateToDate
  },
  passportSeries: {
    key: 'passportSeries',
    prompt: 'Введи серию паспорта: 4 цифры.',
    parse: (value) => passportSeriesSchema.parse(value)
  },
  passportNumber: {
    key: 'passportNumber',
    prompt: 'Введи номер паспорта: 6 цифр.',
    parse: (value) => passportNumberSchema.parse(value)
  },
  passportIssuedAt: {
    key: 'passportIssuedAt',
    prompt: 'Укажи дату выдачи паспорта в формате ДД.ММ.ГГГГ.',
    parse: parseRuDateToDate
  },
  passportIssuedByInstrumental: {
    key: 'passportIssuedByInstrumental',
    prompt: 'Укажи, кем выдан паспорт, в творительном падеже. Например: ОМВД России по району ...',
    parse: (value) => passportIssuedByInstrumentalSchema.parse(value)
  },
  passportDepartmentCode: {
    key: 'passportDepartmentCode',
    prompt: 'Укажи код подразделения паспорта. Можно ввести 770001 или 770-001.',
    parse: (value) => passportDepartmentCodeSchema.parse(value)
  },
  registrationAddress: {
    key: 'registrationAddress',
    prompt: 'Укажи адрес регистрации.',
    parse: (value) => registrationAddressSchema.parse(value)
  },
  inn: {
    key: 'inn',
    prompt: 'Укажи ИНН.',
    parse: (value) => innSchema.parse(value)
  },
  ogrnip: {
    key: 'ogrnip',
    prompt: 'Введи ОГРНИП.',
    parse: (value) => ogrnipSchema.parse(value)
  },
  taxSystem: {
    key: 'taxSystem',
    prompt: 'Укажи систему налогообложения. Например: УСН, плательщик НДС.',
    parse: (value) => taxSystemSchema.parse(value)
  },
  bankAccount: {
    key: 'bankAccount',
    prompt: 'Введи расчетный счет.',
    parse: (value) => bankAccountSchema.parse(value)
  },
  bankName: {
    key: 'bankName',
    prompt: 'Укажи название банка.',
    parse: (value) => bankNameSchema.parse(value)
  },
  bankBik: {
    key: 'bankBik',
    prompt: 'Введи БИК банка.',
    parse: (value) => bankBikSchema.parse(value)
  },
  bankCorrAccount: {
    key: 'bankCorrAccount',
    prompt: 'Введи корреспондентский счет.',
    parse: (value) => bankCorrAccountSchema.parse(value)
  },
  phone: {
    key: 'phone',
    prompt: 'Укажи телефон для связи.',
    parse: (value) => phoneSchema.parse(value)
  },
  email: {
    key: 'email',
    prompt: 'Укажи email.',
    parse: (value) => emailSchema.parse(value)
  }
};

const selfEmployedFields: RegistrationField[] = [
  'fullName',
  'contractStartDate',
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

const ipFields: RegistrationField[] = [
  'fullName',
  'contractStartDate',
  'contractDeadlineDate',
  'passportSeries',
  'passportNumber',
  'passportIssuedAt',
  'passportIssuedByInstrumental',
  'passportDepartmentCode',
  'registrationAddress',
  'inn',
  'ogrnip',
  'taxSystem',
  'bankAccount',
  'bankName',
  'bankBik',
  'bankCorrAccount',
  'phone',
  'email'
];

const noContractFields: RegistrationField[] = [
  'fullName',
  'phone',
  'email'
];

const CHANGE_LEGAL_TYPE_CALLBACK = 'register_change_legal_type';

const legalTypeChangeFields = new Set<RegistrationField>([
  'contractStartDate',
  'contractDeadlineDate',
  'passportSeries',
  'registrationAddress',
  'ogrnip'
]);

const changeLegalTypeInlineKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Сменить юридический тип', CHANGE_LEGAL_TYPE_CALLBACK)]
  ]);

const getState = (ctx: BotContext): RegistrationState => {
  const state = ctx.wizard.state as RegistrationState;
  state.draft ??= {};
  state.fieldIndex ??= 0;
  return state;
};

const getFieldsForDraft = (draft: RegistrationDraft) =>
  isNoContractLegalType(draft.legalType)
    ? noContractFields
    : draft.legalType === LegalType.IP
      ? ipFields
      : selfEmployedFields;

const getText = (ctx: BotContext) => getMessageText(ctx.message);

const formatDraftDate = (value: unknown) =>
  value instanceof Date || typeof value === 'string' ? formatRussianDate(value) : '—';

const askCurrentField = async (ctx: BotContext) => {
  const state = getState(ctx);
  const fields = getFieldsForDraft(state.draft);
  const field = fields[state.fieldIndex];

  if (!field) {
    await showReview(ctx);
    return ctx.wizard.selectStep(3);
  }

  await ctx.reply(fieldConfigs[field].prompt, cancelSceneKeyboard());
  if (legalTypeChangeFields.has(field)) {
    await ctx.reply(
      'Если юридический тип выбран случайно, нажми кнопку ниже и выбери правильный вариант.',
      changeLegalTypeInlineKeyboard()
    );
  }
  return undefined;
};

const restartLegalTypeSelection = async (ctx: BotContext) => {
  const state = getState(ctx);
  state.draft = {
    ...state.draft,
    legalType: null,
    ogrnip: undefined
  };
  state.fieldIndex = 0;

  await safeAnswerCbQuery(ctx);

  try {
    await container.services.creatorProfileService.saveDraft(ctx.state.currentUser!.id, state.draft);
  } catch (error) {
    logUserError(error, 'Creator registration legal type reset failed', {
      userId: ctx.state.currentUser?.id
    });
  }

  await ctx.reply(
    'Хорошо, выбери юридический тип заново.',
    legalTypeInlineKeyboard()
  );
  return ctx.wizard.selectStep(1);
};

const buildDraftFromProfile = (
  profile: NonNullable<BotContext['state']['currentUser']>['creatorProfile'] | null | undefined
) => {
  if (!profile) {
    return {};
  }

  return {
    legalType: profile.legalType,
    fullName: profile.fullName ?? undefined,
    contractStartDate: profile.contractStartDate ?? undefined,
    contractDeadlineDate: profile.contractDeadlineDate ?? undefined,
    passportSeries: profile.passportSeries ?? undefined,
    passportNumber: profile.passportNumber ?? undefined,
    passportIssuedAt: profile.passportIssuedAt ?? undefined,
    passportIssuedByInstrumental: profile.passportIssuedByInstrumental ?? undefined,
    passportDepartmentCode: profile.passportDepartmentCode ?? undefined,
    registrationAddress: profile.registrationAddress ?? undefined,
    inn: profile.inn ?? undefined,
    ogrnip: profile.ogrnip ?? undefined,
    taxSystem: profile.taxSystem ?? undefined,
    bankAccount: profile.bankAccount ?? undefined,
    bankName: profile.bankName ?? undefined,
    bankBik: profile.bankBik ?? undefined,
    bankCorrAccount: profile.bankCorrAccount ?? undefined,
    phone: profile.phone ?? undefined,
    email: profile.email ?? undefined
  } satisfies RegistrationDraft;
};

const canResumeRegistrationFromProfile = (
  profile?: ExistingCreatorProfile | null
) =>
  profile?.legalType === LegalType.SELF_EMPLOYED ||
  profile?.legalType === LegalType.IP ||
  Boolean(profile?.profileCompleted && isNoContractLegalType(profile.legalType));

const isRegistrationFieldFilled = (draft: RegistrationDraft, field: RegistrationField) => {
  const value = draft[field];

  if (value instanceof Date) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return value !== null && value !== undefined;
};

const findFirstMissingFieldIndex = (draft: RegistrationDraft) =>
  getFieldsForDraft(draft).findIndex((field) => !isRegistrationFieldFilled(draft, field));

const showReview = async (ctx: BotContext) => {
  const draft = getState(ctx).draft;
  const legalType = isNoContractLegalType(draft.legalType)
    ? 'Без договора'
    : draft.legalType === LegalType.IP
      ? 'ИП'
      : 'Самозанятый / СЗ';

  await ctx.reply(
    [
      'Проверь, пожалуйста, анкету перед подтверждением.',
      '',
      `Тип: ${legalType}`,
      `ФИО: ${draft.fullName ?? '—'}`,
      isNoContractLegalType(draft.legalType)
        ? null
        : `Дата договора: ${formatDraftDate(draft.contractStartDate)}`,
      isNoContractLegalType(draft.legalType)
        ? null
        : `Срок выполнения договора: ${formatDraftDate(draft.contractDeadlineDate)}`,
      '',
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP ? 'Паспортные данные:' : null,
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP
        ? `Паспорт: ${draft.passportSeries ?? '—'} ${draft.passportNumber ?? ''}`.trim()
        : null,
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP
        ? `Дата выдачи: ${formatDraftDate(draft.passportIssuedAt)}`
        : null,
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP
        ? `Кем выдан: ${draft.passportIssuedByInstrumental ?? '—'}`
        : null,
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP
        ? `Код подразделения: ${draft.passportDepartmentCode ?? '—'}`
        : null,
      draft.legalType === LegalType.SELF_EMPLOYED || draft.legalType === LegalType.IP ? '' : null,
      isNoContractLegalType(draft.legalType) ? null : 'Реквизиты:',
      isNoContractLegalType(draft.legalType) ? null : `Адрес регистрации: ${draft.registrationAddress ?? '—'}`,
      isNoContractLegalType(draft.legalType) ? null : `ИНН: ${draft.inn ?? '—'}`,
      draft.legalType === LegalType.IP ? `ОГРНИП: ${draft.ogrnip ?? '—'}` : null,
      draft.legalType === LegalType.IP ? `Система налогообложения: ${draft.taxSystem ?? '—'}` : null,
      isNoContractLegalType(draft.legalType) ? null : `Расчетный счет: ${draft.bankAccount ?? '—'}`,
      isNoContractLegalType(draft.legalType) ? null : `Банк: ${draft.bankName ?? '—'}`,
      isNoContractLegalType(draft.legalType) ? null : `БИК: ${draft.bankBik ?? '—'}`,
      isNoContractLegalType(draft.legalType) ? null : `Корр. счет: ${draft.bankCorrAccount ?? '—'}`,
      `Телефон: ${draft.phone ?? '—'}`,
      `Email: ${draft.email ?? '—'}`
    ]
      .filter((line) => line !== null)
      .join('\n'),
    confirmInlineKeyboard('register_confirm', 'register_edit')
  );
};

const startCreatorDocumentsAfterRegistrationInBackground = (ctx: BotContext) => {
  const userId = ctx.state.currentUser?.id;
  const telegramUserId = ctx.from?.id;
  const updateId = ctx.update.update_id;

  void startCreatorDocumentsAfterRegistration(ctx).catch(async (error) => {
    logUserError(error, 'Creator post-registration documents flow failed', {
      userId,
      telegramUserId,
      updateId
    });

    try {
      await ctx.reply(
        formatUserError(
          error,
          'Анкета сохранена, но сейчас не удалось подготовить документы. Открой документы из меню или попробуй позже.'
        )
      );
    } catch (replyError) {
      logUserError(replyError, 'Creator post-registration documents failure reply failed', {
        userId,
        telegramUserId,
        updateId
      });
    }
  });
};

export const creatorRegistrationScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.creatorRegistration,
  async (ctx) => {
    const state = getState(ctx);
    const profile = ctx.state.currentUser?.creatorProfile;
    state.draft = buildDraftFromProfile(profile);
    state.fieldIndex = 0;

    if (canResumeRegistrationFromProfile(profile)) {
      const missingFieldIndex = findFirstMissingFieldIndex(state.draft);

      if (missingFieldIndex === -1) {
        state.fieldIndex = getFieldsForDraft(state.draft).length;
        await showReview(ctx);
        return ctx.wizard.selectStep(3);
      }

      state.fieldIndex = missingFieldIndex;
      await askCurrentField(ctx);
      return ctx.wizard.selectStep(2);
    }

    await ctx.reply(
      'Давай завершим анкету. Сначала выбери юридический тип.',
      legalTypeInlineKeyboard()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data.startsWith('register_legal:')) {
      const state = getState(ctx);
      const selectedLegalType = ctx.callbackQuery.data.split(':')[1];
      state.draft.legalType =
        selectedLegalType === NO_CONTRACT_REGISTRATION_VALUE ? null : legalTypeSchema.parse(selectedLegalType);
      state.fieldIndex = 0;
      await safeAnswerCbQuery(ctx);
      await askCurrentField(ctx);
      return ctx.wizard.next();
    }

    await ctx.reply('Выбери тип кнопкой ниже.', legalTypeInlineKeyboard());
  },
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === CHANGE_LEGAL_TYPE_CALLBACK) {
      return restartLegalTypeSelection(ctx);
    }

    const state = getState(ctx);
    const fields = getFieldsForDraft(state.draft);
    const field = fields[state.fieldIndex];

    if (!field) {
      await showReview(ctx);
      return ctx.wizard.selectStep(3);
    }

    let value: string | Date;

    try {
      value = fieldConfigs[field].parse(getText(ctx));
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Поле заполнено неверно.'));
      return;
    }

    state.draft = {
      ...state.draft,
      [field]: value
    };

    try {
      await container.services.creatorProfileService.saveDraft(ctx.state.currentUser!.id, state.draft);
      state.fieldIndex += 1;

      if (state.fieldIndex >= fields.length) {
        await showReview(ctx);
        return ctx.wizard.selectStep(3);
      }

      await askCurrentField(ctx);
    } catch (error) {
      logUserError(error, 'Creator registration draft save failed', {
        userId: ctx.state.currentUser?.id,
        field
      });
      await ctx.reply('Сейчас не удалось сохранить анкету. Попробуй еще раз немного позже.');
    }
  },
  async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      await showReview(ctx);
      return;
    }

    if (ctx.callbackQuery.data === 'register_edit') {
      const state = getState(ctx);
      state.fieldIndex = 0;
      await safeAnswerCbQuery(ctx);
      await ctx.reply(
        'Хорошо, пройдем анкету еще раз. Сначала выбери юридический тип.',
        legalTypeInlineKeyboard()
      );
      return ctx.wizard.selectStep(1);
    }

    if (ctx.callbackQuery.data === 'register_confirm') {
      await safeAnswerCbQuery(ctx, 'Сохраняю анкету...');

      try {
        await container.services.creatorProfileService.completeProfile(
          ctx.state.currentUser!.id,
          getState(ctx).draft as never
        );
      } catch (error) {
        logUserError(error, 'Creator registration completion failed', {
          userId: ctx.state.currentUser?.id
        });
        await ctx.reply(formatUserError(error, 'Сейчас не удалось завершить регистрацию. Проверь анкету и попробуй еще раз.'));
        return;
      }

      await ctx.scene.leave();
      startCreatorDocumentsAfterRegistrationInBackground(ctx);
    }
  }
);
