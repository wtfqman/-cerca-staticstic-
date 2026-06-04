import { DocumentType, LegalType } from '@prisma/client';

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

export type DocumentPayloadValidationIssue = {
  code: string;
  field?: string;
  message: string;
};

export class DocumentPayloadValidationError extends Error {
  constructor(
    readonly type: DocumentType,
    readonly issues: DocumentPayloadValidationIssue[]
  ) {
    super(
      [
        `Документ не сформирован: payload для «${type}» не прошел проверку согласованности.`,
        ...issues.map((issue) => `- ${issue.message}`)
      ].join('\n')
    );
    this.name = 'DocumentPayloadValidationError';
  }
}

const MONTH_NUMBER_BY_GENITIVE_NAME: Record<string, string> = {
  января: '01',
  февраля: '02',
  марта: '03',
  апреля: '04',
  мая: '05',
  июня: '06',
  июля: '07',
  августа: '08',
  сентября: '09',
  октября: '10',
  ноября: '11',
  декабря: '12'
};

const DOCUMENT_DATE_FIELD_BY_TYPE: Partial<Record<DocumentType, string>> = {
  [DocumentType.ASSIGNMENT]: 'assignmentDate',
  [DocumentType.ACT]: 'actDate',
  [DocumentType.ACT_1000]: 'actDate',
  [DocumentType.RIGHTS_TRANSFER]: 'rightsTransferDate'
};

const MONTHLY_DOCUMENT_TYPES = new Set<DocumentType>([
  DocumentType.ASSIGNMENT,
  DocumentType.ACT,
  DocumentType.ACT_1000,
  DocumentType.RIGHTS_TRANSFER
]);

const DOCUMENT_TYPES_REQUIRING_CONTRACT_REFERENCE = new Set<DocumentType>([
  DocumentType.CONTRACT,
  DocumentType.ASSIGNMENT,
  DocumentType.ACT,
  DocumentType.ACT_1000,
  DocumentType.RIGHTS_TRANSFER
]);

const LEGACY_TEMPLATE_DATE_MARKERS = [
  '05.05.2025',
  '05 мая 2025'
];

const pad2 = (value: string | number) => String(value).padStart(2, '0');

const buildDateKey = (year: string, month: string, day: string) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));

  if (
    date.getUTCFullYear() !== numericYear ||
    date.getUTCMonth() !== numericMonth - 1 ||
    date.getUTCDate() !== numericDay
  ) {
    return null;
  }

  return `${numericYear}-${pad2(numericMonth)}-${pad2(numericDay)}`;
};

const normalizeDateText = (value: string) =>
  value
    .trim()
    .replace(/[«»"]/g, '')
    .replace(/\s*г\.?$/i, '')
    .replace(/\s+/g, ' ');

const parseDateKey = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return buildDateKey(
      String(value.getUTCFullYear()),
      String(value.getUTCMonth() + 1),
      String(value.getUTCDate())
    );
  }

  if (typeof value !== 'string') {
    return null;
  }

  const text = normalizeDateText(value);
  const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (dotted) {
    const [, day, month, year] = dotted;
    return buildDateKey(year, month, day);
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (iso) {
    const [, year, month, day] = iso;
    return buildDateKey(year, month, day);
  }

  const longRu = text.toLocaleLowerCase('ru-RU').match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/);

  if (longRu) {
    const [, day, monthName, year] = longRu;
    const month = MONTH_NUMBER_BY_GENITIVE_NAME[monthName.replace(/ё/g, 'е')];

    return month ? buildDateKey(year, month, day) : null;
  }

  return null;
};

const formatDateKeyDotted = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-');
  return `${day}.${month}.${year}`;
};

const formatDateKeyLong = (dateKey: string, withLeadingZero: boolean) => {
  const [year, month, day] = dateKey.split('-');
  const monthName = Object.entries(MONTH_NUMBER_BY_GENITIVE_NAME)
    .find(([, number]) => number === month)?.[0] ?? month;

  return `${withLeadingZero ? day : String(Number(day))} ${monthName} ${year}`;
};

const getPayloadRecord = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
};

const readPayloadString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return typeof value === 'string' ? value.trim() : '';
};

const readPayloadBoolean = (payload: Record<string, unknown>, key: string) =>
  payload[key] === true || getPayloadRecord(payload, 'workflow')[key] === true;

const addIssue = (
  issues: DocumentPayloadValidationIssue[],
  code: string,
  message: string,
  field?: string
) => {
  issues.push({
    code,
    field,
    message
  });
};

const requireTextPayloadField = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>,
  field: string,
  label: string
) => {
  const value = readPayloadString(payload, field);

  if (!value || looksLikePlaceholderText(value)) {
    addIssue(issues, 'required_text', `поле «${label}» обязательно и не может быть пустым`, field);
    return '';
  }

  return value;
};

const requireDatePayloadField = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>,
  field: string,
  label: string
) => {
  const value = readPayloadString(payload, field);
  const dateKey = parseDateKey(value);

  if (!dateKey) {
    addIssue(issues, 'required_date', `поле «${label}» должно содержать корректную дату`, field);
    return null;
  }

  return dateKey;
};

const optionalDatePayloadField = (payload: Record<string, unknown>, field: string) => {
  const value = readPayloadString(payload, field);

  return value ? parseDateKey(value) : null;
};

const assertDateFieldsMatch = (
  issues: DocumentPayloadValidationIssue[],
  left: { key: string; label: string; value: string | null },
  right: { key: string; label: string; value: string | null },
  code: string
) => {
  if (left.value && right.value && left.value !== right.value) {
    addIssue(
      issues,
      code,
      `даты «${left.label}» и «${right.label}» не совпадают (${formatDateKeyDotted(left.value)} / ${formatDateKeyDotted(right.value)})`,
      left.key
    );
  }
};

const assertDateFieldUnused = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>,
  field: string,
  currentType: DocumentType
) => {
  const value = readPayloadString(payload, field);

  if (value && value !== '—') {
    addIssue(
      issues,
      'unexpected_date_field',
      `поле «${field}» не должно заполняться для документа ${currentType}`,
      field
    );
  }
};

const assertPeriodDates = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>
) => {
  const periodStart = requireDatePayloadField(issues, payload, 'periodStartDate', 'начало периода');
  const periodEnd = requireDatePayloadField(issues, payload, 'periodEndDate', 'конец периода');

  if (periodStart && periodEnd && periodStart > periodEnd) {
    addIssue(
      issues,
      'invalid_period',
      `начало периода позже конца периода (${formatDateKeyDotted(periodStart)} / ${formatDateKeyDotted(periodEnd)})`,
      'periodStartDate'
    );
  }

  return { periodStart, periodEnd };
};

const extractDateKeysFromContractNumber = (contractNumber: string) =>
  [...contractNumber.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g)]
    .map((match) => buildDateKey(match[3], match[2], match[1]))
    .filter((value): value is string => Boolean(value));

const assertContractReferenceValid = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>
) => {
  const contractNumber = requireTextPayloadField(issues, payload, 'contractNumber', 'номер договора');
  const contractDate = requireDatePayloadField(issues, payload, 'contractDate', 'дата договора');

  if (!contractNumber || !contractDate) {
    return { contractNumber, contractDate };
  }

  const numberDates = extractDateKeysFromContractNumber(contractNumber);

  if (numberDates.length === 0) {
    addIssue(
      issues,
      'contract_number_without_date',
      `номер договора «${contractNumber}» должен содержать дату в формате ДД.ММ.ГГГГ`,
      'contractNumber'
    );
    return { contractNumber, contractDate };
  }

  if (!numberDates.includes(contractDate)) {
    addIssue(
      issues,
      'contract_number_date_mismatch',
      `дата внутри номера договора «${contractNumber}» не совпадает с contractDate ${formatDateKeyDotted(contractDate)}`,
      'contractNumber'
    );
  }

  return { contractNumber, contractDate };
};

const assertNoIrrelevantMonthlyDateFields = (
  issues: DocumentPayloadValidationIssue[],
  payload: Record<string, unknown>,
  type: DocumentType
) => {
  for (const field of Object.values(DOCUMENT_DATE_FIELD_BY_TYPE)) {
    if (field !== DOCUMENT_DATE_FIELD_BY_TYPE[type]) {
      assertDateFieldUnused(issues, payload, field, type);
    }
  }
};

export const assertDocumentPayloadValidForRender = (input: {
  type: DocumentType;
  payload: Record<string, unknown>;
}) => {
  const { type, payload } = input;
  const issues: DocumentPayloadValidationIssue[] = [];
  const payloadDocumentType = payload.documentType;

  if (payloadDocumentType && payloadDocumentType !== type) {
    addIssue(
      issues,
      'document_type_mismatch',
      `payload.documentType=${String(payloadDocumentType)} не совпадает с типом генерации ${type}`,
      'documentType'
    );
  }

  const documentDate = requireDatePayloadField(issues, payload, 'documentDate', 'дата документа');
  const companySignDate = requireDatePayloadField(issues, payload, 'companySignDate', 'дата подписи компании');
  const creatorSignDate = requireDatePayloadField(issues, payload, 'creatorSignDate', 'дата подписи исполнителя');
  const allowSplitSignDates = readPayloadBoolean(payload, 'allowSplitSignDates');
  const allowSignDateDifferentFromDocumentDate = readPayloadBoolean(payload, 'allowSignDateDifferentFromDocumentDate');

  if (!allowSplitSignDates) {
    assertDateFieldsMatch(
      issues,
      { key: 'companySignDate', label: 'дата подписи компании', value: companySignDate },
      { key: 'creatorSignDate', label: 'дата подписи исполнителя', value: creatorSignDate },
      'conflicting_sign_dates'
    );
  }

  if (!allowSignDateDifferentFromDocumentDate) {
    assertDateFieldsMatch(
      issues,
      { key: 'companySignDate', label: 'дата подписи компании', value: companySignDate },
      { key: 'documentDate', label: 'дата документа', value: documentDate },
      'sign_date_document_date_mismatch'
    );
    assertDateFieldsMatch(
      issues,
      { key: 'creatorSignDate', label: 'дата подписи исполнителя', value: creatorSignDate },
      { key: 'documentDate', label: 'дата документа', value: documentDate },
      'sign_date_document_date_mismatch'
    );
  }

  if (DOCUMENT_TYPES_REQUIRING_CONTRACT_REFERENCE.has(type)) {
    const { contractDate } = assertContractReferenceValid(issues, payload);

    if (type === DocumentType.CONTRACT) {
      assertDateFieldsMatch(
        issues,
        { key: 'contractDate', label: 'дата договора', value: contractDate },
        { key: 'documentDate', label: 'дата документа', value: documentDate },
        'contract_date_document_date_mismatch'
      );
    }
  } else if (readPayloadString(payload, 'contractNumber') || readPayloadString(payload, 'contractDate')) {
    const contractNumber = readPayloadString(payload, 'contractNumber');
    const contractDate = optionalDatePayloadField(payload, 'contractDate');

    if (contractNumber && contractDate) {
      const numberDates = extractDateKeysFromContractNumber(contractNumber);

      if (numberDates.length > 0 && !numberDates.includes(contractDate)) {
        addIssue(
          issues,
          'contract_number_date_mismatch',
          `дата внутри номера договора «${contractNumber}» не совпадает с contractDate ${formatDateKeyDotted(contractDate)}`,
          'contractNumber'
        );
      }
    }
  }

  assertNoIrrelevantMonthlyDateFields(issues, payload, type);

  if (type === DocumentType.ASSIGNMENT) {
    const assignmentDate = requireDatePayloadField(issues, payload, 'assignmentDate', 'дата задания');
    assertDateFieldsMatch(
      issues,
      { key: 'assignmentDate', label: 'дата задания', value: assignmentDate },
      { key: 'documentDate', label: 'дата документа', value: documentDate },
      'type_date_document_date_mismatch'
    );

    const periodStart = optionalDatePayloadField(payload, 'periodStartDate');

    if (periodStart) {
      assertDateFieldsMatch(
        issues,
        { key: 'assignmentDate', label: 'дата задания', value: assignmentDate },
        { key: 'periodStartDate', label: 'начало периода', value: periodStart },
        'assignment_date_period_start_mismatch'
      );
    }
  }

  if (type === DocumentType.ACT || type === DocumentType.ACT_1000) {
    const actDate = requireDatePayloadField(issues, payload, 'actDate', 'дата акта');
    const { periodEnd } = assertPeriodDates(issues, payload);
    assertDateFieldsMatch(
      issues,
      { key: 'actDate', label: 'дата акта', value: actDate },
      { key: 'documentDate', label: 'дата документа', value: documentDate },
      'type_date_document_date_mismatch'
    );
    assertDateFieldsMatch(
      issues,
      { key: 'actDate', label: 'дата акта', value: actDate },
      { key: 'periodEndDate', label: 'конец периода', value: periodEnd },
      'act_date_period_end_mismatch'
    );
  }

  if (type === DocumentType.RIGHTS_TRANSFER) {
    const rightsTransferDate = requireDatePayloadField(
      issues,
      payload,
      'rightsTransferDate',
      'дата передачи прав'
    );
    const { periodEnd } = assertPeriodDates(issues, payload);
    assertDateFieldsMatch(
      issues,
      { key: 'rightsTransferDate', label: 'дата передачи прав', value: rightsTransferDate },
      { key: 'documentDate', label: 'дата документа', value: documentDate },
      'type_date_document_date_mismatch'
    );
    assertDateFieldsMatch(
      issues,
      { key: 'rightsTransferDate', label: 'дата передачи прав', value: rightsTransferDate },
      { key: 'periodEndDate', label: 'конец периода', value: periodEnd },
      'rights_transfer_date_period_end_mismatch'
    );
  }

  if (MONTHLY_DOCUMENT_TYPES.has(type) && !readPayloadString(payload, 'monthKey')) {
    addIssue(issues, 'required_month_key', 'ежемесячный документ должен содержать monthKey', 'monthKey');
  }

  if (issues.length > 0) {
    throw new DocumentPayloadValidationError(type, issues);
  }
};

const normalizeRenderedText = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

const renderedTextIncludesDate = (text: string, dateKey: string) => {
  const [year, month, day] = dateKey.split('-');
  const monthName = Object.entries(MONTH_NUMBER_BY_GENITIVE_NAME)
    .find(([, number]) => number === month)?.[0] ?? month;
  const variants = [
    formatDateKeyDotted(dateKey),
    formatDateKeyLong(dateKey, true),
    formatDateKeyLong(dateKey, false),
    `«${day}» ${monthName} ${year}`,
    `"${day}" ${monthName} ${year}`
  ].map((value) => value.toLocaleLowerCase('ru-RU'));
  const normalizedText = text.toLocaleLowerCase('ru-RU');

  return variants.some((variant) => normalizedText.includes(variant));
};

const assertRenderedTextContains = (
  issues: DocumentPayloadValidationIssue[],
  text: string,
  expected: string,
  label: string
) => {
  if (!text.toLocaleLowerCase('ru-RU').includes(expected.toLocaleLowerCase('ru-RU'))) {
    addIssue(issues, 'rendered_text_missing_value', `в DOCX-тексте не найдено значение «${label}»: ${expected}`);
  }
};

const assertRenderedTextContainsDate = (
  issues: DocumentPayloadValidationIssue[],
  text: string,
  dateKey: string | null,
  label: string
) => {
  if (dateKey && !renderedTextIncludesDate(text, dateKey)) {
    addIssue(
      issues,
      'rendered_text_missing_date',
      `в DOCX-тексте не найдена дата «${label}»: ${formatDateKeyDotted(dateKey)}`
    );
  }
};

export const assertRenderedDocumentTextValid = (input: {
  type: DocumentType;
  payload: Record<string, unknown>;
  text: string;
}) => {
  const text = normalizeRenderedText(input.text);
  const issues: DocumentPayloadValidationIssue[] = [];

  for (const marker of LEGACY_TEMPLATE_DATE_MARKERS) {
    if (text.includes(marker)) {
      addIssue(
        issues,
        'legacy_template_date_marker',
        `после рендера в документе осталась старая шаблонная дата ${marker}`
      );
    }
  }

  if (text.includes('{{') || text.includes('}}')) {
    addIssue(issues, 'unresolved_template_placeholder', 'после рендера в DOCX остался незамененный placeholder');
  }

  if (DOCUMENT_TYPES_REQUIRING_CONTRACT_REFERENCE.has(input.type)) {
    const contractNumber = readPayloadString(input.payload, 'contractNumber');
    const contractDate = optionalDatePayloadField(input.payload, 'contractDate');

    if (contractNumber) {
      assertRenderedTextContains(issues, text, contractNumber, 'номер договора');
    }

    assertRenderedTextContainsDate(issues, text, contractDate, 'дата договора');
  }

  const ownDateField = DOCUMENT_DATE_FIELD_BY_TYPE[input.type];

  if (ownDateField) {
    assertRenderedTextContainsDate(
      issues,
      text,
      optionalDatePayloadField(input.payload, ownDateField),
      ownDateField
    );
  }

  if (input.type === DocumentType.ACT || input.type === DocumentType.ACT_1000) {
    assertRenderedTextContainsDate(
      issues,
      text,
      optionalDatePayloadField(input.payload, 'periodStartDate'),
      'начало периода'
    );
  }

  if (
    input.type === DocumentType.ACT ||
    input.type === DocumentType.ACT_1000 ||
    input.type === DocumentType.RIGHTS_TRANSFER
  ) {
    assertRenderedTextContainsDate(
      issues,
      text,
      optionalDatePayloadField(input.payload, 'periodEndDate'),
      'конец периода'
    );
  }

  if (issues.length > 0) {
    throw new DocumentPayloadValidationError(input.type, issues);
  }
};
