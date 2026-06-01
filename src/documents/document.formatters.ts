import type { Document, DocumentSignatureUpload, User } from '@prisma/client';

import { DocumentStatus, DocumentType } from '@prisma/client';

import { getDocumentTitle } from './document.constants';
import { isActiveRosterResigningScopeKey, isCreatorInvoiceMonth } from './document-workflow.constants';
import { getCreatorInvoiceDisplayAmount } from '../payments/payment.constants';
import { formatFullName, formatRussianDate, formatRussianDateTime } from '../utils/formatters';
import type {
  ActiveRosterFirstQueueDocumentStatus,
  ActiveRosterFirstQueueSummary,
  ActiveRosterSecondQueueDocumentStatus,
  ActiveRosterSecondQueueSummary,
  ActiveRosterPaymentQueueStatus
} from '../services/document-workflow.service';

const documentStatusLabelMap: Record<DocumentStatus | 'NOT_GENERATED', string> = {
  [DocumentStatus.GENERATED]: 'сформирован, ожидает отправки',
  [DocumentStatus.SENT_TO_CREATOR]: 'отправлен креатору, ожидает подписи',
  [DocumentStatus.VIEWED_BY_CREATOR]: 'просмотрен креатором, ожидает подписи',
  [DocumentStatus.SIGNED_UPLOADED]: 'подписанный PDF загружен',
  [DocumentStatus.FORWARDED_TO_CHAT]: 'подписанный PDF загружен и переслан',
  [DocumentStatus.FAILED]: 'ошибка формирования',
  NOT_GENERATED: 'не сформирован'
};

export const formatDocumentStatus = (status: DocumentStatus | 'NOT_GENERATED') =>
  documentStatusLabelMap[status] ?? status;

type DocumentStatusLineInput = Pick<
  Document,
  'type' | 'monthKey' | 'status' | 'fileName' | 'generatedAt' | 'sentAt' | 'signedUploadedAt' | 'forwardedAt'
> & {
  scopeKey?: string | null;
  signatureUploads?: Array<
    Pick<
      DocumentSignatureUpload,
      'originalFileName' | 'uploadedAt' | 'forwardedChatId' | 'forwardedMessageId'
    >
  >;
};

const formatDocumentScopeSuffix = (scopeKey?: string | null) =>
  isActiveRosterResigningScopeKey(scopeKey) ? ' - переподписание' : '';

export const formatDocumentStatusLine = (document: DocumentStatusLineInput) => {
  const latestUpload = document.signatureUploads?.[0];
  const title = `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}${formatDocumentScopeSuffix(document.scopeKey)}`;

  return [
    `${title}: ${formatDocumentStatus(document.status)}`,
    `  Сформирован: ${formatRussianDate(document.generatedAt)}`,
    `  Отправлен креатору: ${document.sentAt ? formatRussianDate(document.sentAt) : 'нет'}`,
    document.signedUploadedAt
      ? `  Подписанный PDF: загружен ${formatRussianDate(document.signedUploadedAt)}`
      : '  Подписанный PDF: еще не загружен',
    document.forwardedAt
      ? `  Переслан в чат: ${formatRussianDate(document.forwardedAt)}`
      : document.signedUploadedAt
        ? '  Переслан в чат: нет, файл сохранен в боте'
        : '  Переслан в чат: еще нет',
    latestUpload
      ? `  Последний файл: ${latestUpload.originalFileName}${
          latestUpload.forwardedMessageId ? `, сообщение ${latestUpload.forwardedMessageId}` : ''
        }`
      : null
  ]
    .filter(Boolean)
    .join('\n');
};

const formatFirstQueueDocumentStatus = (document: ActiveRosterFirstQueueDocumentStatus) =>
  document.status === 'NOT_GENERATED' ? 'не отправлен' : formatDocumentStatus(document.status);

const formatFirstQueueDocumentLine = (document: ActiveRosterFirstQueueDocumentStatus) => {
  const title = `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}`;

  return [
    `${title}: ${formatFirstQueueDocumentStatus(document)}`,
    document.generatedAt ? `  Сформирован: ${formatRussianDate(document.generatedAt)}` : '  Сформирован: нет',
    document.sentAt ? `  Отправлен: ${formatRussianDate(document.sentAt)}` : '  Отправлен: нет',
    document.signedUploadedAt
      ? `  Подписанный PDF: загружен ${formatRussianDate(document.signedUploadedAt)}`
      : '  Подписанный PDF: еще не загружен',
    document.forwardedAt
      ? `  Переслан в чат: ${formatRussianDate(document.forwardedAt)}`
      : document.signedUploadedAt
        ? '  Переслан в чат: нет, файл сохранен в боте'
        : '  Переслан в чат: еще нет',
    document.latestUploadName ? `  Последний файл: ${document.latestUploadName}` : null
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatActiveRosterFirstQueueStatus = (summary: ActiveRosterFirstQueueSummary) =>
  [
    summary.campaignTitle,
    '',
    `Договор формируется датой: ${formatRussianDate(summary.contractDate)}`,
    `Задания: ${summary.periodMonths.join(', ') || 'периоды не заданы'}`,
    `Статус первой очереди: ${summary.isCompleted ? 'закрыта' : 'ждет подписанные PDF'}`,
    summary.completedAt ? `Закрыта: ${formatRussianDate(summary.completedAt)}` : null,
    '',
    'Первая очередь:',
    ...summary.documents.map(formatFirstQueueDocumentLine),
    '',
    summary.isCompleted
      ? 'Все документы первой очереди подписаны и загружены.'
      : 'Подпиши договор и NDA, затем отправь подписанные PDF обратно в бот.'
  ]
    .filter(Boolean)
    .join('\n');

type CreatorVisibleDocumentStatus = DocumentStatus | 'NOT_GENERATED' | 'LOCKED';

const signedStatuses = new Set<CreatorVisibleDocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

const formatCreatorDocumentStatus = (status: CreatorVisibleDocumentStatus) => {
  if (status === 'LOCKED') {
    return 'будет доступен позже';
  }

  if (status === 'NOT_GENERATED') {
    return 'не сформирован';
  }

  if (signedStatuses.has(status)) {
    return 'подписан';
  }

  if (status === DocumentStatus.SENT_TO_CREATOR || status === DocumentStatus.VIEWED_BY_CREATOR) {
    return 'отправлен';
  }

  if (status === DocumentStatus.GENERATED) {
    return 'сформирован';
  }

  return 'ошибка';
};

const isCreatorDocumentSigned = (document: {
  status: CreatorVisibleDocumentStatus;
  signedUploadedAt?: Date | null;
}) =>
  signedStatuses.has(document.status) || Boolean(document.signedUploadedAt);

const isCreatorDocumentWaitingForSignature = (status: CreatorVisibleDocumentStatus) =>
  status === DocumentStatus.SENT_TO_CREATOR ||
  status === DocumentStatus.VIEWED_BY_CREATOR ||
  status === DocumentStatus.GENERATED;

const formatCreatorDocumentTitle = (document: {
  type: DocumentType;
  monthKey?: string | null;
}) => `${getDocumentTitle(document.type)}${document.monthKey ? ` за ${document.monthKey}` : ''}`;

const formatCreatorDocumentLine = (document: {
  type: DocumentType;
  monthKey?: string | null;
  status: CreatorVisibleDocumentStatus;
  signedUploadedAt?: Date | null;
}) => {
  const uploadStatus = isCreatorDocumentSigned(document)
    ? 'загружен'
    : isCreatorDocumentWaitingForSignature(document.status)
      ? 'НЕ загружен'
      : formatCreatorDocumentStatus(document.status);

  return `- ${formatCreatorDocumentTitle(document)}: ${uploadStatus}`;
};

const formatCreatorUploadChecklist = (
  documents: Array<{
    type: DocumentType;
    monthKey?: string | null;
    status: CreatorVisibleDocumentStatus;
    signedUploadedAt?: Date | null;
  }>
) => {
  const signedCount = documents.filter(isCreatorDocumentSigned).length;
  const totalCount = documents.length;
  const waitingDocuments = documents.filter((document) => !isCreatorDocumentSigned(document));
  const formatWaitingDocument = (document: (typeof documents)[number]) => {
    const title = formatCreatorDocumentTitle(document);

    if (document.status === 'LOCKED' || document.status === 'NOT_GENERATED') {
      return `- ${title}: ${formatCreatorDocumentStatus(document.status)}`;
    }

    return `- ${title}`;
  };

  return [
    `Подписанные PDF: ${signedCount} из ${totalCount}`,
    'Осталось догрузить:',
    ...(waitingDocuments.length
      ? waitingDocuments.map(formatWaitingDocument)
      : totalCount === 0
        ? ['- документы еще не сформированы']
        : ['- ничего, все нужные PDF уже загружены'])
  ];
};

export const formatCreatorFirstQueueScreen = (summary: ActiveRosterFirstQueueSummary) => {
  const hasGeneratedDocuments = summary.documents.some((document) => document.status !== 'NOT_GENERATED');
  const allDocumentsGenerated =
    summary.documents.length > 0 && summary.documents.every((document) => document.status !== 'NOT_GENERATED');

  return [
    'Мои документы',
    '',
    summary.isCompleted
      ? 'Первая очередь подписана. Следующий шаг - задание и акт.'
      : allDocumentsGenerated
        ? 'Документы уже отправлены. Подпиши договор и NDA, затем отправь подписанные PDF обратно в бот. Повторная отправка - только по кнопке.'
        : hasGeneratedDocuments
          ? 'Часть документов уже есть, но комплект неполный. Открой формирование первой очереди вручную, чтобы получить полный актуальный пакет.'
        : 'Сначала сформируй первую очередь: договор и NDA. Потом подпиши их и отправь PDF обратно в бот.',
    '',
    ...formatCreatorUploadChecklist(summary.documents),
    '',
    'Первая очередь:',
    ...summary.documents.map(formatCreatorDocumentLine)
  ].join('\n');
};

const formatMoneyPlain = (value?: number | null) =>
  typeof value === 'number'
    ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} руб.`
    : 'нет данных';

const formatIntegerPlain = (value?: number | null) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
    : 'нет данных';

const formatSecondQueueDocumentStatus = (document: ActiveRosterSecondQueueDocumentStatus) => {
  if (document.status === 'LOCKED') {
    return 'недоступен до закрытия первой очереди';
  }

  if (document.status === 'NOT_GENERATED') {
    return 'не отправлен';
  }

  return formatDocumentStatus(document.status);
};

const formatSecondQueueDocumentLine = (document: ActiveRosterSecondQueueDocumentStatus) => {
  const isGenerated = document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED';
  const showPaymentDetails = isGenerated && document.type === DocumentType.ACT;

  return [
    `${getDocumentTitle(document.type)} (${document.monthKey}): ${formatSecondQueueDocumentStatus(document)}`,
    showPaymentDetails ? `  Ролики: ${formatIntegerPlain(document.actualVideoCount)}` : null,
    showPaymentDetails ? `  Окладная часть: ${formatMoneyPlain(document.fixedSalaryPart)}` : null,
    showPaymentDetails ? `  Охваты: ${formatIntegerPlain(document.rawViews)}` : null,
    showPaymentDetails ? `  Часть за охваты: ${formatMoneyPlain(document.variablePart)}` : null,
    showPaymentDetails ? `  Итого по акту: ${formatMoneyPlain(document.totalPayment)}` : null,
    document.generatedAt ? `  Сформирован: ${formatRussianDate(document.generatedAt)}` : null,
    document.sentAt ? `  Отправлен: ${formatRussianDate(document.sentAt)}` : null,
    document.signedUploadedAt
      ? `  Подписанный PDF: загружен ${formatRussianDate(document.signedUploadedAt)}`
      : isGenerated
        ? '  Подписанный PDF: еще не загружен'
        : null,
    document.forwardedAt
      ? `  Переслан в чат: ${formatRussianDate(document.forwardedAt)}`
      : document.signedUploadedAt
        ? '  Переслан в чат: нет, файл сохранен в боте'
        : null,
    document.latestUploadName ? `  Последний файл: ${document.latestUploadName}` : null
  ]
    .filter(Boolean)
    .join('\n');
};

const formatInvoiceQueueLine = (payment: ActiveRosterPaymentQueueStatus) => {
  if (payment.invoiceUploadedAt) {
    return `${payment.monthKey}: загружен ${formatRussianDate(payment.invoiceUploadedAt)}`;
  }

  return payment.secondQueueSigned
    ? `${payment.monthKey}: можно загрузить`
    : `${payment.monthKey}: недоступен до подписания второй очереди`;
};

const formatReceiptQueueLine = (payment: ActiveRosterPaymentQueueStatus) => {
  if (payment.receiptUploadedAt) {
    return `${payment.monthKey}: загружен ${formatRussianDate(payment.receiptUploadedAt)}`;
  }

  if (payment.receiptReminderSentAt) {
    return `${payment.monthKey}: напоминание отправлено ${formatRussianDate(payment.receiptReminderSentAt)}`;
  }

  if (payment.receiptExpectedAt) {
    return payment.receiptReminderDueAt
      ? `${payment.monthKey}: ожидается, напоминание после ${formatRussianDateTime(payment.receiptReminderDueAt)}`
      : `${payment.monthKey}: ожидается`;
  }

  return payment.invoiceUploadedAt
    ? `${payment.monthKey}: пока не загружен`
    : `${payment.monthKey}: пока не ожидается`;
};

const formatCreatorInvoiceStatus = (payment: ActiveRosterPaymentQueueStatus) => {
  if (payment.invoiceUploadedAt) {
    return 'загружен';
  }

  return payment.secondQueueSigned ? 'можно выставить' : 'после второй очереди';
};

export const getCreatorInvoiceAmount = (payment: ActiveRosterPaymentQueueStatus) =>
  payment.secondQueueSigned && !payment.invoiceUploadedAt && typeof payment.totalPayment === 'number'
    ? getCreatorInvoiceDisplayAmount(payment.totalPayment)
    : null;

export const formatCreatorInvoiceAmountHint = (payment: ActiveRosterPaymentQueueStatus) => {
  const amount = getCreatorInvoiceAmount(payment);

  return typeof amount === 'number' ? `Сумма для счета: ${formatMoneyPlain(amount)}` : null;
};

const formatCreatorInvoiceAmount = (payment: ActiveRosterPaymentQueueStatus) => {
  const amount = getCreatorInvoiceAmount(payment);

  return typeof amount === 'number' ? ` на ${formatMoneyPlain(amount)}` : null;
};

const formatCreatorReceiptStatus = (payment: ActiveRosterPaymentQueueStatus) => {
  if (payment.receiptUploadedAt) {
    return 'загружен';
  }

  if (payment.receiptExpectedAt) {
    return 'ожидается';
  }

  return payment.invoiceUploadedAt ? 'нужно загрузить' : 'после счета';
};

const formatCreatorPaymentLine = (payment: ActiveRosterPaymentQueueStatus) =>
  `- ${payment.monthKey}: счет - ${formatCreatorInvoiceStatus(payment)}${formatCreatorInvoiceAmount(payment) ?? ''}, чек - ${formatCreatorReceiptStatus(payment)}`;

export const formatCreatorSecondQueueScreen = (summary: ActiveRosterSecondQueueSummary) => {
  if (!summary.isFirstQueueCompleted) {
    return [
      'Следующий шаг',
      '',
      'Вторая очередь откроется после первой: сначала нужно подписать договор и NDA.',
      'После подписи отправь PDF обратно в бот.'
    ].join('\n');
  }
  const hasGeneratedDocuments = summary.documents.some(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );
  const allDocumentsGenerated =
    summary.documents.length > 0 &&
    summary.documents.every((document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED');
  const billablePayments = summary.payments.filter((payment) => isCreatorInvoiceMonth(payment.monthKey));

  return [
    'Мои документы',
    '',
    summary.isCompleted
      ? 'Вторая очередь подписана. Теперь выставь счет на сумму ниже, затем загрузи чек.'
      : allDocumentsGenerated
        ? 'Теперь подпиши задание и акт. После подписания отправь PDF обратно в бот.'
        : hasGeneratedDocuments
          ? 'Часть документов второй очереди уже есть. Сформируй вторую очередь еще раз, чтобы получить полный комплект.'
          : 'Сформируй вторую очередь: задание и акт. Потом подпиши их и отправь PDF обратно в бот.',
    '',
    ...formatCreatorUploadChecklist(summary.documents),
    '',
    'Вторая очередь:',
    ...summary.documents.map(formatCreatorDocumentLine),
    '',
    'Счет и чек:',
    ...(billablePayments.length ? billablePayments.map(formatCreatorPaymentLine) : ['- актуальный период не задан'])
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatActiveRosterSecondQueueStatus = (summary: ActiveRosterSecondQueueSummary) => {
  const billablePayments = summary.payments.filter((payment) => isCreatorInvoiceMonth(payment.monthKey));

  return [
    'Вторая очередь документов: задание и акт',
    '',
    `Периоды: ${summary.periodMonths.join(', ') || 'периоды не заданы'}`,
    `Статус второй очереди: ${
      summary.isCompleted
        ? 'закрыта'
        : summary.isFirstQueueCompleted
          ? 'можно формировать задание и акт'
          : 'заблокирована'
    }`,
    summary.lockedReason ?? null,
    summary.completedAt ? `Закрыта: ${formatRussianDate(summary.completedAt)}` : null,
    '',
    'Вторая очередь документов:',
    ...summary.documents.map(formatSecondQueueDocumentLine),
    '',
    'Счет:',
    ...(billablePayments.length ? billablePayments.map(formatInvoiceQueueLine) : ['актуальный период не задан']),
    '',
    'Чек:',
    ...(billablePayments.length ? billablePayments.map(formatReceiptQueueLine) : ['актуальный период не задан']),
    '',
    summary.isFirstQueueCompleted
      ? 'Задание и акт можно сформировать отдельной кнопкой. После подписи отправь PDF обратно в бот.'
      : 'Сначала нужно закрыть первую очередь: договор и NDA.'
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatDocumentCaption = (document: Pick<Document, 'type' | 'monthKey' | 'generatedAt'>) => {
  const base = getDocumentTitle(document.type);
  return document.monthKey
    ? `${base} за ${document.monthKey}\nСформирован: ${formatRussianDate(document.generatedAt)}`
    : `${base}\nСформирован: ${formatRussianDate(document.generatedAt)}`;
};

export const formatDocumentUploadPrompt = (
  document: Pick<Document, 'id' | 'type' | 'monthKey'> & {
    scopeKey?: string | null;
    status?: DocumentStatus;
    signedUploadedAt?: Date | null;
  }
) => {
  const statusSuffix = document.signedUploadedAt || (document.status && signedStatuses.has(document.status))
    ? ' - подпись загружена, можно обновить'
    : ' - ждет подписанный PDF';

  return `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}${formatDocumentScopeSuffix(document.scopeKey)}${statusSuffix}`;
};

export const formatForwardCaption = (
  document: Pick<Document, 'id' | 'type' | 'monthKey' | 'status'>,
  creator: Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'role'> & {
    telegramId?: string | null;
    creatorProfile?: { fullName: string | null } | null;
  },
  upload: Pick<DocumentSignatureUpload, 'id' | 'originalFileName' | 'uploadedAt'>,
  options: { wasAlreadySigned?: boolean } = {}
) =>
  [
    'Подписанный PDF загружен',
    `Креатор: ${creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, 'Креатор')}`,
    creator.username ? `Telegram: @${creator.username}` : creator.telegramId ? `Telegram ID: ${creator.telegramId}` : null,
    `Роль: ${creator.role}`,
    `Документ: ${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}`,
    document.monthKey ? `Период: ${document.monthKey}` : null,
    `Версия: ${options.wasAlreadySigned ? 'обновление подписанного PDF' : 'первичная загрузка подписи'}`,
    `Файл: ${upload.originalFileName}`,
    `Загружен: ${formatRussianDateTime(upload.uploadedAt)}`,
    `Статус: ${formatDocumentStatus(document.status)}`
  ]
    .filter(Boolean)
    .join('\n');

export const formatSignedUploadDocumentTitle = (
  document: Pick<Document, 'type' | 'monthKey'> & { scopeKey?: string | null }
) => `${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}${formatDocumentScopeSuffix(document.scopeKey)}`;

export const formatSignedUploadNextStep = (input: {
  signedCount: number;
  totalCount: number;
  remainingTitles: string[];
}) =>
  input.remainingTitles.length
    ? [
        `Подписано: ${input.signedCount} из ${input.totalCount}.`,
        `Осталось загрузить: ${input.remainingTitles.join(', ')}.`
      ].join('\n')
    : `Подписано: ${input.signedCount} из ${input.totalCount}. Все PDF первой очереди загружены.`;

export type SignedDocumentForwardingResult =
  | { status: 'forwarded'; chatId: string; messageId: number }
  | { status: 'queued'; chatId: string }
  | { status: 'pending_manual_export'; chatId: string }
  | { status: 'skipped'; reason: 'chat_not_configured' }
  | { status: 'failed'; chatId: string; errorMessage?: string };

export const formatSignedUploadResultMessage = (
  forwarding: SignedDocumentForwardingResult,
  options: {
    wasAlreadySigned?: boolean;
    document?: Pick<Document, 'type' | 'monthKey'> & { scopeKey?: string | null };
    nextStep?: string;
  } = {}
) =>
  [
    options.document
      ? `${options.wasAlreadySigned ? 'Новая версия подписанного PDF сохранена' : 'Подписанный PDF сохранен'}: ${formatSignedUploadDocumentTitle(options.document)}.`
      : options.wasAlreadySigned
        ? 'Новый подписанный PDF получен и сохранен как последняя версия.'
        : 'Подписанный PDF получен и сохранен.',
    forwarding.status === 'forwarded'
      ? `Файл переслан в служебный чат документов, сообщение ${forwarding.messageId}.`
      : forwarding.status === 'queued'
        ? 'Файл будет отправлен в служебный чат одним блоком с другими документами этого креатора.'
      : forwarding.status === 'pending_manual_export'
        ? 'PDF сохранен в боте. Администратор выгрузит новые документы в рабочий чат кнопкой «Выгрузить документы».'
      : forwarding.status === 'skipped'
        ? 'Служебный чат для документов пока не настроен, поэтому файл не пересылался. Он сохранен в боте и будет виден администратору в статусах документов.'
        : 'Не удалось переслать файл в служебный чат, но PDF сохранен в боте. Администратор увидит, что подпись загружена.',
    options.nextStep ?? null
  ]
    .filter(Boolean)
    .join('\n');

export const getDocumentTypeByCallback = (value: string): DocumentType | null => {
  if (Object.values(DocumentType).includes(value as DocumentType)) {
    return value as DocumentType;
  }

  return null;
};
