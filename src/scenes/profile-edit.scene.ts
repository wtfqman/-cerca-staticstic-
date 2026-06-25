import { LegalType } from '@prisma/client';
import { Scenes } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { approvalInlineKeyboard, profileEditFieldKeyboard, profileLegalTypeKeyboard } from '../keyboards/inline.keyboards';
import { SCENE_IDS } from './scene-ids';
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
import {
  creatorProfileFieldLabels,
  getCreatorProfileEditableFields,
  type CreatorProfileEditableField
} from '../services/creator-profile.service';
import {
  CONTRACT_DEADLINE_EDIT_PROMPT,
  CONTRACT_START_DATE_EDIT_PROMPT,
  CREATOR_SELF_EDIT_DISABLED_TEXT
} from '../texts/messages';
import { getMessageText } from '../utils/telegram';
import { formatCreatorDisplayName, formatRussianDate } from '../utils/formatters';
import { formatUserError, formatValidationError, logUserError } from '../utils/user-errors';

type ProfileEditState = {
  creatorUserId?: string;
  changeRequestId?: string;
  allowedFields?: CreatorProfileEditableField[];
  field?: CreatorProfileEditableField;
  newValue?: string | Date | LegalType;
  newValueDisplay?: string;
};

const dateFields = new Set<CreatorProfileEditableField>([
  'contractStartDate',
  'contractDeadlineDate',
  'passportIssuedAt'
]);

const parseDateInput = (value: string) => {
  const parsed = parseRuDateToDate(value);

  return {
    value: parsed,
    display: formatRussianDate(parsed)
  };
};

const fieldPrompts: Record<CreatorProfileEditableField, string> = {
  legalType: 'Выбери новый юридический тип для анкеты. После смены креатор дозаполнит договорные данные в профиле.',
  fullName: 'Введи новое ФИО полностью.',
  contractStartDate: CONTRACT_START_DATE_EDIT_PROMPT,
  contractDeadlineDate: CONTRACT_DEADLINE_EDIT_PROMPT,
  registrationAddress: 'Введи новый адрес регистрации.',
  inn: 'Введи новый ИНН.',
  bankAccount: 'Введи новый расчетный счет.',
  bankName: 'Введи новое название банка.',
  bankBik: 'Введи новый БИК.',
  bankCorrAccount: 'Введи новый корреспондентский счет.',
  phone: 'Введи новый телефон.',
  email: 'Введи новый email.',
  passportSeries: 'Введи новую серию паспорта, 4 цифры.',
  passportNumber: 'Введи новый номер паспорта, 6 цифр.',
  passportIssuedAt: 'Введи новую дату выдачи паспорта в формате ДД.ММ.ГГГГ.',
  passportIssuedByInstrumental: 'Введи, кем выдан паспорт, в творительном падеже.',
  passportDepartmentCode: 'Введи новый код подразделения паспорта. Можно 770001 или 770-001.',
  ogrnip: 'Введи новый ОГРНИП.',
  taxSystem: 'Введи систему налогообложения. Например: УСН, плательщик НДС.'
};

const parseFieldValue = (field: CreatorProfileEditableField, input: string) => {
  if (field === 'legalType') {
    const normalized = input.trim().toUpperCase();
    const alias =
      normalized === 'САМОЗАНЯТЫЙ' || normalized === 'СЗ'
        ? LegalType.SELF_EMPLOYED
        : normalized === 'ИП'
          ? LegalType.IP
          : undefined;
    const value = alias ?? legalTypeSchema.parse(normalized);

    return {
      value,
      display: value === LegalType.SELF_EMPLOYED ? 'Самозанятый / СЗ' : 'ИП'
    };
  }

  if (dateFields.has(field)) {
    return parseDateInput(input);
  }

  const schemaMap: Partial<Record<CreatorProfileEditableField, { parse: (value: string) => string }>> = {
    fullName: fullNameSchema,
    registrationAddress: registrationAddressSchema,
    inn: innSchema,
    bankAccount: bankAccountSchema,
    bankName: bankNameSchema,
    bankBik: bankBikSchema,
    bankCorrAccount: bankCorrAccountSchema,
    phone: phoneSchema,
    email: emailSchema,
    passportSeries: passportSeriesSchema,
    passportNumber: passportNumberSchema,
    passportIssuedByInstrumental: passportIssuedByInstrumentalSchema,
    passportDepartmentCode: passportDepartmentCodeSchema,
    ogrnip: ogrnipSchema,
    taxSystem: taxSystemSchema
  };

  const value = schemaMap[field]?.parse(input);

  if (!value) {
    throw new Error('Это поле нельзя изменить для текущего типа анкеты.');
  }

  return {
    value,
    display: value
  };
};

const getState = (ctx: BotContext) => ctx.wizard.state as ProfileEditState;

const getNewValueForSave = (state: ProfileEditState) => {
  if (!state.field || state.newValue === undefined) {
    throw new Error('Не выбрано поле для изменения.');
  }

  return state.newValue;
};

const loadEditableCreator = async (ctx: BotContext) => {
  const actor = ctx.state.currentUser;
  const state = getState(ctx);

  if (!actor) {
    throw new Error('Пользователь не найден.');
  }

  if (!state.creatorUserId) {
    throw new Error('Креатор для редактирования не выбран.');
  }

  if (actor.id === state.creatorUserId) {
    throw new Error(CREATOR_SELF_EDIT_DISABLED_TEXT);
  }

  if (state.changeRequestId) {
    const request = await container.services.creatorProfileChangeRequestService.assertApprovedEditableRequest(
      actor,
      state.changeRequestId,
      state.creatorUserId
    );
    state.allowedFields = request.fields;
  }

  return container.services.creatorProfileService.getManageableCreatorProfile(actor, state.creatorUserId);
};

const getSceneEditableFields = (
  creator: Awaited<ReturnType<typeof loadEditableCreator>>,
  state: ProfileEditState
) => {
  const profileFields = getCreatorProfileEditableFields(creator.creatorProfile?.legalType);

  if (!state.allowedFields?.length) {
    return profileFields;
  }

  return profileFields.filter((field) => state.allowedFields?.includes(field));
};

export const profileEditScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.profileEdit,
  async (ctx) => {
    try {
      const creator = await loadEditableCreator(ctx);
      const fields = getSceneEditableFields(creator, getState(ctx));

      await ctx.reply(
        [
          `Редактирование анкеты: ${formatCreatorDisplayName(creator)}`,
          '',
          'Выбери одно поле, которое нужно изменить.'
        ].join('\n'),
        profileEditFieldKeyboard(fields)
      );
      return ctx.wizard.next();
    } catch (error) {
      logUserError(error, 'Profile edit scene open failed', {
        userId: ctx.state.currentUser?.id,
        creatorUserId: getState(ctx).creatorUserId
      });
      await ctx.reply(formatUserError(error, 'Сейчас не удалось открыть редактирование анкеты. Попробуй еще раз.'));
      await ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      const creator = await loadEditableCreator(ctx);
      const fields = getSceneEditableFields(creator, getState(ctx));

      if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data.startsWith('profile_edit_field:')) {
        const field = ctx.callbackQuery.data.split(':')[1] as CreatorProfileEditableField;

        if (!fields.includes(field)) {
          await ctx.answerCbQuery();
          await ctx.reply('Это поле недоступно для текущего типа анкеты.');
          return;
        }

        getState(ctx).field = field;
        await ctx.answerCbQuery();
        await ctx.reply(fieldPrompts[field], field === 'legalType' ? profileLegalTypeKeyboard() : undefined);
        return ctx.wizard.next();
      }

      await ctx.reply('Выбери поле кнопкой ниже.', profileEditFieldKeyboard(fields));
    } catch (error) {
      logUserError(error, 'Profile edit scene step failed', {
        userId: ctx.state.currentUser?.id,
        creatorUserId: getState(ctx).creatorUserId
      });
      await ctx.reply(formatUserError(error, 'Сейчас не удалось продолжить редактирование. Попробуй еще раз.'));
      await ctx.scene.leave();
    }
  },
  async (ctx) => {
    const state = getState(ctx);
    const field = state.field;
    const legalTypeCallback =
      field === 'legalType' &&
      ctx.callbackQuery &&
      'data' in ctx.callbackQuery &&
      ctx.callbackQuery.data.startsWith('profile_edit_legal:')
        ? ctx.callbackQuery.data.split(':')[1]
        : undefined;

    if (!field || (!legalTypeCallback && !('text' in (ctx.message ?? {})))) {
      await ctx.reply(
        field === 'legalType'
          ? 'Выбери новый юридический тип кнопкой ниже.'
          : 'Жду текстовое значение для выбранного поля.',
        field === 'legalType' ? profileLegalTypeKeyboard() : undefined
      );
      return;
    }

    try {
      const creator = await loadEditableCreator(ctx);
      const message = ctx.message;
      const textInput = message && 'text' in message ? getMessageText(message) : '';
      const parsed = parseFieldValue(field, legalTypeCallback ?? textInput);
      state.newValue = parsed.value;
      state.newValueDisplay = parsed.display;

      if (legalTypeCallback) {
        await ctx.answerCbQuery();
      }

      const currentValue = creator.creatorProfile?.[field];
      const currentDisplay = container.services.creatorProfileService.formatFieldValue(field, currentValue);

      await ctx.reply(
        [
          `Поле: ${creatorProfileFieldLabels[field]}`,
          `Сейчас: ${currentDisplay}`,
          `Новое значение: ${parsed.display}`,
          '',
          'Сохранить изменение?'
        ].join('\n'),
        approvalInlineKeyboard('profile_edit_confirm', 'profile_edit_cancel')
      );
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Значение не подошло.'));
    }
  },
  async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      await ctx.reply('Подтверди сохранение кнопкой ниже.');
      return;
    }

    if (ctx.callbackQuery.data === 'profile_edit_cancel') {
      const state = getState(ctx);
      const actor = ctx.state.currentUser;

      if (actor && state.changeRequestId) {
        const request = await container.services.creatorProfileChangeRequestService.cancelApprovedEdit(
          actor,
          state.changeRequestId
        );

        await ctx.telegram.sendMessage(
          request.creator.telegramId,
          'Тимлид отменил редактирование. Данные не изменены.'
        );
      }

      await ctx.answerCbQuery();
      await ctx.reply('Изменение отменено.');
      await ctx.scene.leave();
      return;
    }

    if (ctx.callbackQuery.data !== 'profile_edit_confirm') {
      return;
    }

    try {
      const actor = ctx.state.currentUser;
      const state = getState(ctx);

      if (!actor || !state.creatorUserId || !state.field) {
        throw new Error('Не удалось определить, что нужно сохранить.');
      }

      await container.services.creatorProfileService.updateRegistrationField(
        actor,
        state.creatorUserId,
        state.field,
        getNewValueForSave(state)
      );

      if (state.changeRequestId) {
        const request = await container.services.creatorProfileChangeRequestService.complete(
          actor,
          state.changeRequestId
        );
        const creatorMessage =
          state.field === 'legalType'
            ? [
                'Юридический тип анкеты обновлен.',
                'Теперь открой "Мой профиль" или /start и дозаполни договорные данные.',
                'После завершения анкеты бот сможет сформировать документы на подпись.'
              ].join('\n')
            : [
                'Данные обновлены.',
                `Тимлид изменил поле: ${creatorProfileFieldLabels[state.field]}.`,
                'Новые данные будут использоваться в профиле и следующих документах.'
              ].join('\n');

        await ctx.telegram.sendMessage(request.creator.telegramId, creatorMessage);
      }

      await ctx.answerCbQuery();
      await ctx.reply(
        state.field === 'legalType'
          ? 'Юридический тип сохранен. Анкета креатора снова открыта для дозаполнения договорных данных.'
          : 'Данные сохранены. Новое значение будет использоваться в профиле и документах креатора.'
      );
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'Profile edit save failed', {
        userId: ctx.state.currentUser?.id,
        creatorUserId: getState(ctx).creatorUserId,
        field: getState(ctx).field
      });
      await ctx.reply(formatUserError(error, 'Сейчас не удалось сохранить изменение. Попробуй еще раз.'));
      await ctx.scene.leave();
    }
  }
);
