import { z } from 'zod';

export const legalTypeSchema = z.enum(['SELF_EMPLOYED', 'IP']);

const requiredText = (message: string, max = 500) => z.string().trim().min(1, message).max(max);
const requiredDigits = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .regex(/^\d+$/, 'Нужно ввести только цифры');

const isValidRuDate = (value: string) => {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);

  if (!match) {
    return false;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const parseRuDateToDate = (value: string) => {
  const normalized = dateRuSchema.parse(value);
  const [day, month, year] = normalized.split('.').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
};

export const fullNameSchema = requiredText('Введите ФИО полностью', 200).min(
  5,
  'Введите ФИО полностью'
);

export const dateRuSchema = z
  .string()
  .trim()
  .min(1, 'Это поле нельзя оставить пустым')
  .regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Дата должна быть в формате ДД.ММ.ГГГГ')
  .refine(isValidRuDate, 'Дата должна быть реальной и в формате ДД.ММ.ГГГГ');

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Введите телефон')
  .max(40, 'Слишком длинный телефон')
  .regex(/^[\d+\s().-]+$/, 'Телефон должен содержать только цифры и допустимые символы')
  .refine((value) => value.replace(/\D/g, '').length >= 7, 'Введите телефон с номером минимум из 7 цифр');

export const emailSchema = z.string().trim().min(1, 'Введите email').email('Введи корректный e-mail');
export const registrationAddressSchema = requiredText('Укажите адрес регистрации', 400).min(
  5,
  'Укажите адрес регистрации'
);

export const innSchema = z
  .string()
  .trim()
  .min(1, 'Укажите ИНН')
  .regex(/^\d+$/, 'Нужно ввести только цифры')
  .regex(/^\d{10}(\d{2})?$/, 'ИНН должен содержать 10 или 12 цифр');

export const passportSeriesSchema = requiredDigits('Укажите серию паспорта').length(
  4,
  'Серия паспорта должна содержать 4 цифры'
);

export const passportNumberSchema = requiredDigits('Укажите номер паспорта').length(
  6,
  'Номер паспорта должен содержать 6 цифр'
);

export const normalizePassportDepartmentCode = (value: string) => {
  const digits = value.replace(/\D/g, '');

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
};

export const passportDepartmentCodeSchema = z
  .string()
  .trim()
  .min(1, 'Укажите код подразделения паспорта')
  .regex(/^\d{3}-?\d{3}$/, 'Код подразделения должен содержать 6 цифр, например 770-001')
  .transform(normalizePassportDepartmentCode);

export const passportIssuedByInstrumentalSchema = requiredText(
  'Укажите, кем выдан паспорт в творительном падеже',
  500
).min(3, 'Укажите, кем выдан паспорт в творительном падеже');

export const ogrnipSchema = z
  .string()
  .trim()
  .min(1, 'Укажите ОГРНИП')
  .regex(/^\d+$/, 'Нужно ввести только цифры')
  .regex(/^\d{15}$/, 'ОГРНИП должен содержать 15 цифр');

export const bankAccountSchema = requiredDigits('Укажите расчетный счет').length(
  20,
  'Расчетный счет должен содержать 20 цифр'
);

export const bankBikSchema = requiredDigits('Укажите БИК').length(
  9,
  'БИК должен содержать 9 цифр'
);

export const bankCorrAccountSchema = requiredDigits('Укажите корреспондентский счет').length(
  20,
  'Корреспондентский счет должен содержать 20 цифр'
);

export const bankNameSchema = requiredText('Укажите название банка', 250).min(
  3,
  'Укажите название банка'
);
