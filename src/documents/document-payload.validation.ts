import { LegalType } from '@prisma/client';

type CreatorDocumentProfile = {
  legalType: LegalType | null;
  fullName: string | null;
  contractDeadlineDate: Date | string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankBik: string | null;
  bankCorrAccount: string | null;
  passportSeries: string | null;
  passportNumber: string | null;
  passportIssuedAt: Date | string | null;
  passportIssuedByInstrumental: string | null;
  passportDepartmentCode: string | null;
  registrationAddress: string | null;
  ogrnip: string | null;
};

const SUSPICIOUS_EMAIL_DOMAINS = new Set([
  'gamil.com',
  'gmail.con',
  'gnail.com',
  'gnail.con',
  'gmal.com',
  'mail.con',
  'yandex.con',
  'ya.con'
]);

const PLACEHOLDER_TEXT_PATTERN =
  /^(?:test|тест|qwerty|asdf|xxx|---+|нет|не указано|n\/a|null|undefined|0+|1+)$/i;

const normalizeDigits = (value: string | null | undefined) => value?.replace(/\D/g, '') ?? '';

const normalizeText = (value: string | null | undefined) => value?.trim() ?? '';

const hasText = (value: string | null | undefined) => normalizeText(value).length > 0;

const isSingleRepeatedChar = (value: string) => {
  const normalized = value.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]/gi, '');
  const unique = new Set([...normalized]);

  return normalized.length >= 3 && unique.size === 1;
};

const looksLikePlaceholderText = (value: string | null | undefined) => {
  const text = normalizeText(value);

  return !text || PLACEHOLDER_TEXT_PATTERN.test(text) || isSingleRepeatedChar(text);
};

const hasLetters = (value: string) => /[A-Za-zА-Яа-яЁё]/.test(value);

const assertRequiredText = (value: string | null | undefined, label: string) => {
  if (looksLikePlaceholderText(value)) {
    throw new Error(`Документы не сформированы: поле "${label}" не заполнено или похоже на тестовое значение.`);
  }
};

const assertHumanName = (value: string | null | undefined) => {
  assertRequiredText(value, 'ФИО');

  const parts = normalizeText(value)
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2 || parts.some((part) => !/^[A-Za-zА-Яа-яЁё-]{2,}$/.test(part))) {
    throw new Error('Документы не сформированы: ФИО должно быть похоже на настоящее имя.');
  }
};

const assertAddress = (value: string | null | undefined) => {
  assertRequiredText(value, 'Адрес регистрации');

  const text = normalizeText(value);

  if (text.length < 8 || !hasLetters(text)) {
    throw new Error('Документы не сформированы: адрес регистрации заполнен некорректно.');
  }
};

const assertBankName = (value: string | null | undefined) => {
  assertRequiredText(value, 'Название банка');

  const text = normalizeText(value);
  const letterCount = [...text].filter((char) => /[A-Za-zА-Яа-яЁё]/.test(char)).length;

  if (letterCount < 3 || /^\d+$/.test(text)) {
    throw new Error('Документы не сформированы: название банка заполнено некорректно.');
  }
};

const assertDate = (value: Date | string | null | undefined, label: string) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return;
  }

  if (typeof value === 'string' && value.trim() && !Number.isNaN(new Date(value).getTime())) {
    return;
  }

  throw new Error(`Документы не сформированы: не заполнена корректная дата "${label}".`);
};

const assertDigitsLength = (value: string | null | undefined, label: string, length: number) => {
  const digits = normalizeDigits(value);

  if (digits.length !== length) {
    throw new Error(`Документы не сформированы: поле "${label}" должно содержать ${length} цифр.`);
  }

  if (new Set([...digits]).size === 1) {
    throw new Error(`Документы не сформированы: поле "${label}" похоже на тестовый набор цифр.`);
  }
};

const assertInn = (value: string | null | undefined) => {
  const digits = normalizeDigits(value);

  if (digits.length !== 10 && digits.length !== 12) {
    throw new Error('Документы не сформированы: ИНН должен содержать 10 или 12 цифр.');
  }

  if (new Set([...digits]).size === 1) {
    throw new Error('Документы не сформированы: ИНН похож на тестовый набор цифр.');
  }
};

const assertPhone = (value: string | null | undefined) => {
  const digits = normalizeDigits(value);

  if (digits.length < 10 || digits.length > 11) {
    throw new Error('Документы не сформированы: телефон должен содержать 10 или 11 цифр.');
  }
};

const assertEmail = (value: string | null | undefined) => {
  const email = normalizeText(value).toLocaleLowerCase('ru-RU');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Документы не сформированы: email в анкете заполнен некорректно.');
  }

  const domain = email.split('@')[1] ?? '';

  if (SUSPICIOUS_EMAIL_DOMAINS.has(domain)) {
    throw new Error(`Документы не сформированы: email похож на опечатку (${domain}).`);
  }
};

export const assertCreatorDocumentProfileValid = (profile: CreatorDocumentProfile) => {
  assertHumanName(profile.fullName);
  assertDate(profile.contractDeadlineDate, 'Срок выполнения договора');
  assertPhone(profile.phone);
  assertEmail(profile.email);
  assertAddress(profile.registrationAddress);
  assertInn(profile.inn);
  assertBankName(profile.bankName);
  assertDigitsLength(profile.bankAccount, 'Расчетный счет', 20);
  assertDigitsLength(profile.bankBik, 'БИК', 9);
  assertDigitsLength(profile.bankCorrAccount, 'Корреспондентский счет', 20);

  if (profile.legalType === LegalType.IP) {
    assertDigitsLength(profile.ogrnip, 'ОГРНИП', 15);
    return;
  }

  assertDigitsLength(profile.passportSeries, 'Серия паспорта', 4);
  assertDigitsLength(profile.passportNumber, 'Номер паспорта', 6);
  assertDate(profile.passportIssuedAt, 'Дата выдачи паспорта');
  assertRequiredText(profile.passportIssuedByInstrumental, 'Кем выдан паспорт');
  assertDigitsLength(profile.passportDepartmentCode, 'Код подразделения паспорта', 6);
};
