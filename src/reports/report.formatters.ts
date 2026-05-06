import { DocumentType } from '@prisma/client';

import type {
  AdminReportSummary,
  AdminDashboardSummary,
  BulkOperationResult,
  CreatorDocumentStatusSummary,
  CreatorReportSummary,
  CreatorMonthlyVideoStatusSummary,
  CreatorWeeklyDisciplineSummary,
  MonthlyAggregationSummary,
  TeamLeadAttentionSummary,
  TeamLeadGroupReportSummary,
  WeeklyReportReviewSummary
} from '../types/report.types';
import { getDocumentTitle } from '../documents/document.constants';
import { formatIntegerRu, formatMoneyRu, formatRussianDate } from '../utils/formatters';
import { formatPeriodLabel } from '../utils/periods';

const TEMPORARY_REACH_BACKFILL_NOTICE =
  'Детализация по платформам, лайкам, комментариям, репостам и сохранениям в этом временном сценарии не собиралась';

const formatPlatforms = (aggregation: MonthlyAggregationSummary) => {
  if (aggregation.isTemporaryReachBackfill) {
    return [
      `• Общий охват: ${formatIntegerRu(aggregation.totals.views)}`,
      `• ${TEMPORARY_REACH_BACKFILL_NOTICE}`
    ].join('\n');
  }

  return aggregation.platformBreakdown.length
    ? aggregation.platformBreakdown
        .map(
          (item) =>
            `• ${item.platform}: просмотры ${formatIntegerRu(item.views)}, лайки ${formatIntegerRu(item.likes)}, комментарии ${formatIntegerRu(item.comments)}, репосты ${formatIntegerRu(item.reposts)}, сохранения ${formatIntegerRu(item.saves)}`
        )
        .join('\n')
    : '• Платформенные данные пока не внесены';
};

const getEffectiveVideoCount = (aggregation: MonthlyAggregationSummary) =>
  aggregation.monthlyVideoSubmitted ? aggregation.monthlyVideoCount : aggregation.totals.videoCount;

const formatMonthlyVideoValue = (aggregation: MonthlyAggregationSummary) => {
  if (aggregation.monthlyVideoSubmitted) {
    return formatIntegerRu(aggregation.monthlyVideoCount);
  }

  return aggregation.totals.videoCount > 0
    ? `${formatIntegerRu(aggregation.totals.videoCount)} (из недельной статистики)`
    : 'не указано';
};

const buildAggregationDataWarnings = (aggregation: MonthlyAggregationSummary) => {
  const warnings: string[] = [];

  if (aggregation.weeklyReportCount === 0 || aggregation.platformBreakdown.length === 0) {
    warnings.push('нет недельной статистики за выбранный период');
  }

  if (!aggregation.monthlyVideoSubmitted && getEffectiveVideoCount(aggregation) === 0) {
    warnings.push('не указано количество видео за месяц');
  }

  return warnings;
};

const formatAggregationDataNotice = (aggregation: MonthlyAggregationSummary) => {
  const warnings = buildAggregationDataWarnings(aggregation);

  return warnings.length
    ? [
        'Данных пока недостаточно для полноценного расчета:',
        ...warnings.map((warning) => `• ${warning}`),
        'Ниже показано то, что уже есть в базе.'
      ].join('\n')
    : '';
};

const formatPaymentBreakdown = (payment: CreatorReportSummary['payment']) =>
  [
    payment.fixedRatePerVideo
      ? `Оклад: ${formatMoneyRu(payment.fixedSalaryPart)} (${formatIntegerRu(payment.actualVideoCount)} × ${formatMoneyRu(payment.fixedRatePerVideo)}, максимум ${formatMoneyRu(payment.fixedSalaryCap ?? payment.baseSalary)})`
      : `Оклад: ${formatMoneyRu(payment.fixedSalaryPart)}`,
    `Переменная часть: ${formatMoneyRu(payment.variablePart)}`,
    `Итоговая выплата: ${formatMoneyRu(payment.totalPayment)}`,
    `Просмотры для расчета: ${formatIntegerRu(payment.rawViews)} -> ${formatIntegerRu(payment.roundedViews)}`,
    `Ставка: ${formatMoneyRu(payment.appliedRate)} за шаг ${formatIntegerRu(payment.step)} просмотров`
  ].join('\n');

const hasAnyCreatorEntryData = (entry: AdminReportSummary['creators'][number]) =>
  (entry.weeklyReportCount ?? 0) > 0 ||
  entry.totals.views > 0 ||
  entry.totals.videoCount > 0 ||
  entry.monthlyVideoSubmitted === true;

const buildCreatorEntryWarnings = (entry: AdminReportSummary['creators'][number]) => {
  const warnings: string[] = [];
  const effectiveVideoCount = entry.payment?.actualVideoCount ?? entry.totals.videoCount ?? 0;

  if (entry.weeklyReportCount === 0) {
    warnings.push('нет недельной статистики');
  }

  if (entry.monthlyVideoSubmitted === false && effectiveVideoCount === 0) {
    warnings.push('не указано количество видео за месяц');
  }

  return warnings;
};

const hasPaymentDocumentStatus = (entry: AdminReportSummary['creators'][number]) =>
  entry.invoiceUploadedAt !== undefined || entry.receiptUploadedAt !== undefined;

const formatPaymentDocumentStatusLine = (entry: AdminReportSummary['creators'][number]) => {
  if (!hasPaymentDocumentStatus(entry)) {
    return null;
  }

  const invoice = entry.invoiceUploadedAt
    ? `счет загружен ${formatRussianDate(entry.invoiceUploadedAt)}`
    : 'счет не загружен';
  const receipt = entry.receiptUploadedAt
    ? `чек загружен ${formatRussianDate(entry.receiptUploadedAt)}`
    : 'чек не загружен';

  return `  документы оплаты: ${invoice}; ${receipt}`;
};

const formatCreatorPaymentLine = (entry: AdminReportSummary['creators'][number]) => {
  const warnings = buildCreatorEntryWarnings(entry);
  const effectiveVideoCount = entry.payment?.actualVideoCount ?? entry.monthlyVideoCount ?? entry.totals.videoCount ?? 0;
  const displayPayment = entry.invoiceTotalPayment ?? entry.totalPayment;
  const videoCount = entry.monthlyVideoSubmitted === false && effectiveVideoCount > 0
    ? `${formatIntegerRu(effectiveVideoCount)} (из недельной статистики)`
    : entry.monthlyVideoSubmitted === false
      ? 'не указано'
      : formatIntegerRu(entry.monthlyVideoCount ?? effectiveVideoCount);

  return [
    `• ${entry.creatorName}: ${formatMoneyRu(displayPayment)}`,
    formatPaymentDocumentStatusLine(entry),
    entry.payment
      ? `  оклад ${formatMoneyRu(entry.payment.fixedSalaryPart)}${
          entry.payment.fixedRatePerVideo
            ? ` (${formatIntegerRu(entry.payment.actualVideoCount)} × ${formatMoneyRu(entry.payment.fixedRatePerVideo)}, максимум ${formatMoneyRu(entry.payment.fixedSalaryCap ?? entry.payment.baseSalary)})`
            : ''
        }, переменная ${formatMoneyRu(entry.payment.variablePart)}`
      : null,
    typeof entry.baseTotalPayment === 'number' &&
    typeof entry.invoiceSurcharge === 'number' &&
    typeof entry.invoiceTotalPayment === 'number'
      ? `  сумма по акту: ${formatMoneyRu(entry.baseTotalPayment)}; к счету +${formatMoneyRu(entry.invoiceSurcharge)} = ${formatMoneyRu(entry.invoiceTotalPayment)}`
      : null,
    entry.payment
      ? `  видео за месяц: ${videoCount}; просмотры: ${formatIntegerRu(entry.payment.rawViews)} -> ${formatIntegerRu(entry.payment.roundedViews)}`
      : `  видео за месяц: ${videoCount}; просмотры: ${formatIntegerRu(entry.totals.views)}`,
    entry.calculationError ? `  ошибка расчета: ${entry.calculationError}` : null,
    warnings.length ? `  не хватает: ${warnings.join('; ')}` : null
  ]
    .filter(Boolean)
    .join('\n');
};

const formatEntriesDataNotice = (entries: AdminReportSummary['creators']) => {
  if (!entries.length) {
    return 'Креаторов для отчета пока нет.';
  }

  if (!entries.some(hasAnyCreatorEntryData)) {
    return [
      'Данных за выбранный месяц пока нет.',
      'Нужно, чтобы креаторы внесли недельную статистику и указали количество видео за месяц.'
    ].join('\n');
  }

  return '';
};

const noticeLines = (notice: string) => (notice ? [notice, ''] : []);

const submittedReviewStatuses = new Set(['SUBMITTED', 'CONFIRMED']);

const formatWeeklyReportPlatformLine = (item: WeeklyReportReviewSummary['items'][number]) =>
  `  ${item.platform}: просмотры ${formatIntegerRu(item.views)}, лайки ${formatIntegerRu(
    item.likes
  )}, комментарии ${formatIntegerRu(item.comments)}, репосты ${formatIntegerRu(
    item.reposts
  )}, сохранения ${formatIntegerRu(item.saves)}`;

const formatWeeklyReportMetrics = (report: WeeklyReportReviewSummary) =>
  report.isTemporaryReachBackfill
    ? [
        `  Видео за период: ${formatIntegerRu(report.totals.videoCount)}`,
        `  Общий охват: ${formatIntegerRu(report.totals.views)}`,
        `  ${TEMPORARY_REACH_BACKFILL_NOTICE}`
      ].join('\n')
    : [
        `  Видео за неделю: ${formatIntegerRu(report.totals.videoCount)}`,
        `  Просмотры: ${formatIntegerRu(report.totals.views)}, лайки: ${formatIntegerRu(
          report.totals.likes
        )}, комментарии: ${formatIntegerRu(report.totals.comments)}`,
        `  Репосты: ${formatIntegerRu(report.totals.reposts)}, сохранения: ${formatIntegerRu(report.totals.saves)}`,
        report.items.length
          ? report.items.map(formatWeeklyReportPlatformLine).join('\n')
          : '  Данные по платформам пока не внесены'
      ].join('\n');

const formatWeeklyReviewLine = (report: WeeklyReportReviewSummary) => {
  const periodLabel = formatPeriodLabel(report.weekStart, report.weekEnd);
  const attachmentLine =
    report.attachmentCount > 0
      ? `  Скрины: ${formatIntegerRu(report.attachmentCount)}`
      : '  Скрины не приложены';

  if (!submittedReviewStatuses.has(report.status)) {
    return [`• ${periodLabel}: еще не отправлено`, formatWeeklyReportMetrics(report), attachmentLine].join('\n');
  }

  if (!report.isReviewedByTeamLead) {
    return [`• ${periodLabel}: еще не проверено`, formatWeeklyReportMetrics(report), attachmentLine].join('\n');
  }

  return [
    `• ${periodLabel}: проверено тимлидом`,
    formatWeeklyReportMetrics(report),
    `  Проверил: ${report.reviewedByTeamLeadName ?? 'тимлид'}`,
    `  Дата проверки: ${formatRussianDate(report.reviewedAt)}`,
    attachmentLine
  ].join('\n');
};

const formatWeeklyReviewBlock = (reports: WeeklyReportReviewSummary[]) =>
  reports.length
    ? reports.map(formatWeeklyReviewLine).join('\n')
    : 'Недельных отчетов пока нет.';

export const formatWeeklyReviewActionResult = (
  report: WeeklyReportReviewSummary,
  alreadyReviewed: boolean
) =>
  [
    alreadyReviewed ? 'Эта статистика уже была проверена.' : 'Статистика отмечена как проверенная.',
    `Период: ${formatPeriodLabel(report.weekStart, report.weekEnd)}`,
    report.reviewedByTeamLeadName ? `Проверил: ${report.reviewedByTeamLeadName}` : null,
    report.reviewedAt ? `Дата проверки: ${formatRussianDate(report.reviewedAt)}` : null
  ]
    .filter(Boolean)
    .join('\n');

export const formatCreatorMonthlyReport = (report: CreatorReportSummary): string => {
  const dataNotice = formatAggregationDataNotice(report.aggregation);

  return [
    `Отчет за ${report.monthKey}`,
    '',
    ...noticeLines(dataNotice),
    `Недельных отчетов: ${formatIntegerRu(report.aggregation.weeklyReportCount)}`,
    `Видео за месяц: ${formatMonthlyVideoValue(report.aggregation)}`,
    `Сырые просмотры: ${formatIntegerRu(report.payment.rawViews)}`,
    `Округленные просмотры: ${formatIntegerRu(report.payment.roundedViews)}`,
    `Лайки: ${formatIntegerRu(report.aggregation.totals.likes)}`,
    `Комментарии: ${formatIntegerRu(report.aggregation.totals.comments)}`,
    `Репосты: ${formatIntegerRu(report.aggregation.totals.reposts)}`,
    `Сохранения: ${formatIntegerRu(report.aggregation.totals.saves)}`,
    '',
    formatPaymentBreakdown(report.payment),
    '',
    'По платформам:',
    formatPlatforms(report.aggregation),
    '',
    'Проверка тимлидом:',
    formatWeeklyReviewBlock(report.weeklyReports)
  ]
    .filter((line) => line !== null)
    .join('\n');
};

export const formatAggregationSnapshot = (title: string, aggregation: MonthlyAggregationSummary): string =>
  [
    title,
    '',
    `Видео: ${formatIntegerRu(aggregation.totals.videoCount)}`,
    `Просмотры: ${formatIntegerRu(aggregation.totals.views)}`,
    `Лайки: ${formatIntegerRu(aggregation.totals.likes)}`,
    `Комментарии: ${formatIntegerRu(aggregation.totals.comments)}`,
    `Репосты: ${formatIntegerRu(aggregation.totals.reposts)}`,
    `Сохранения: ${formatIntegerRu(aggregation.totals.saves)}`,
    '',
    'По платформам:',
    formatPlatforms(aggregation)
  ].join('\n');

export const formatTeamLeadGroupReport = (report: TeamLeadGroupReportSummary): string =>
  [
    `Отчет по группе за ${report.monthKey}`,
    '',
    ...noticeLines(formatEntriesDataNotice(report.creators)),
    `Видео: ${formatIntegerRu(report.totals.videoCount)}`,
    `Просмотры: ${formatIntegerRu(report.totals.views)}`,
    `Лайки: ${formatIntegerRu(report.totals.likes)}`,
    `Комментарии: ${formatIntegerRu(report.totals.comments)}`,
    `Репосты: ${formatIntegerRu(report.totals.reposts)}`,
    `Сохранения: ${formatIntegerRu(report.totals.saves)}`,
    `Сумма выплат: ${formatMoneyRu(report.totalPayment)}`
  ]
    .filter((line) => line !== null)
    .join('\n');

export const formatAdminReport = (report: AdminReportSummary): string =>
  [
    `Общая статистика за ${report.monthKey}`,
    '',
    ...noticeLines(formatEntriesDataNotice(report.creators)),
    `Видео: ${formatIntegerRu(report.totals.videoCount)}`,
    `Просмотры: ${formatIntegerRu(report.totals.views)}`,
    `Лайки: ${formatIntegerRu(report.totals.likes)}`,
    `Комментарии: ${formatIntegerRu(report.totals.comments)}`,
    `Репосты: ${formatIntegerRu(report.totals.reposts)}`,
    `Сохранения: ${formatIntegerRu(report.totals.saves)}`,
    `Сумма выплат: ${formatMoneyRu(report.totalPayment)}`,
    '',
    'Тимлиды:',
    report.teamLeads.length
      ? report.teamLeads
          .map(
            (item) =>
              `• ${item.teamLeadName}: креаторов ${formatIntegerRu(item.creatorCount)}, сумма ${formatMoneyRu(item.totalPayment)}`
          )
          .join('\n')
      : '• Нет активных групп'
  ]
    .filter((line) => line !== null)
    .join('\n');

export const formatAdminPaymentsReport = (report: AdminReportSummary): string =>
  report.creators.length
    ? [
        `Выплаты за ${report.monthKey}`,
        '',
        ...noticeLines(formatEntriesDataNotice(report.creators)),
        ...report.creators.map(formatCreatorPaymentLine),
        '',
        `Итого: ${formatMoneyRu(report.totalPayment)}`
      ]
        .filter((line) => line !== null)
        .join('\n')
    : [
        `Выплаты за ${report.monthKey}`,
        '',
        'Нет данных по выплатам: активных креаторов пока нет.'
      ].join('\n');

const weeklyStatusLabelMap: Record<CreatorWeeklyDisciplineSummary['status'], string> = {
  NOT_STARTED: 'не начат',
  IN_PROGRESS: 'начат, но не отправлен',
  SUBMITTED: 'отправлен',
  NO_DATA: 'нет данных'
};

const formatWeeklyStatusLine = (item: CreatorWeeklyDisciplineSummary) =>
  `• ${item.creatorName}: ${weeklyStatusLabelMap[item.status]}`;

const formatMonthlyVideoStatusLine = (item: CreatorMonthlyVideoStatusSummary) =>
  item.status === 'SUBMITTED'
    ? `• ${item.creatorName}: ${formatIntegerRu(item.videoCount ?? 0)} видео`
    : `• ${item.creatorName}: количество видео не указано`;

const FIRST_QUEUE_DOCUMENT_TYPES = new Set<DocumentType>([
  DocumentType.CONTRACT,
  DocumentType.NDA,
  DocumentType.ASSIGNMENT
]);
const SECOND_QUEUE_DOCUMENT_TYPES = new Set<DocumentType>([DocumentType.ACT, DocumentType.RIGHTS_TRANSFER]);

const getMissingRequiredDocuments = (
  item: CreatorDocumentStatusSummary,
  filter?: (type: DocumentType) => boolean
) =>
  [...item.oneOff, ...item.monthly].filter((document) => {
    const type = document.type as DocumentType;
    return document.required && !document.signed && (!filter || filter(type));
  });

const formatMissingDocumentDetail = (document: ReturnType<typeof getMissingRequiredDocuments>[number]) =>
  `  - ${getDocumentTitle(document.type as DocumentType)}: ${
    document.generated ? 'ожидает подпись' : 'не сгенерирован'
  }`;

const formatDocumentRequirementLine = (
  item: CreatorDocumentStatusSummary,
  filter?: (type: DocumentType) => boolean
) => [`• ${item.creatorName}`, ...getMissingRequiredDocuments(item, filter).map(formatMissingDocumentDetail)].join('\n');

const formatDocumentQueueAttention = (
  title: string,
  items: CreatorDocumentStatusSummary[],
  documentTypes: Set<DocumentType>
) => {
  const queueItems = items.filter((item) =>
    getMissingRequiredDocuments(item, (type) => documentTypes.has(type)).length > 0
  );

  return [
    `${title}: ${formatIntegerRu(queueItems.length)}`,
    queueItems.length
      ? queueItems
          .map((item) => formatDocumentRequirementLine(item, (type) => documentTypes.has(type)))
          .join('\n')
      : '• Нет'
  ].join('\n');
};

export const formatMissingWeeklyStats = (items: CreatorWeeklyDisciplineSummary[]) =>
  items.length
    ? ['Не сдали недельную статистику:', ...items.map(formatWeeklyStatusLine)].join('\n')
    : 'По недельной статистике все в порядке.';

export const formatMissingMonthlyVideos = (items: CreatorMonthlyVideoStatusSummary[], monthKey: string) =>
  items.length
    ? [`Не указано количество видео за ${monthKey}:`, ...items.map(formatMonthlyVideoStatusLine)].join('\n')
    : `Количество видео за ${monthKey} указано у всех креаторов.`;

export const formatMissingDocuments = (items: CreatorDocumentStatusSummary[], monthKey: string) =>
  items.length
    ? [`Нет полного пакета подписанных документов за ${monthKey}:`, ...items.map((item) => formatDocumentRequirementLine(item))].join('\n')
    : `Подписанные документы за ${monthKey} получены по всем креаторам.`;

export const formatTeamLeadAttentionSummary = (summary: TeamLeadAttentionSummary) =>
  [
    `Требует внимания по группе`,
    '',
    `Креаторов в группе: ${formatIntegerRu(summary.creatorsTotal)}`,
    `Период статистики: ${summary.weekStart} - ${summary.weekEnd}`,
    `Месяц видео: ${summary.monthKey}`,
    `Месяц документов: ${summary.documentMonthKey}`,
    '',
    `Не сдали документы за ${summary.documentMonthKey}: ${formatIntegerRu(summary.documentsMissing.length)}`,
    formatDocumentQueueAttention('Первая очередь', summary.documentsMissing, FIRST_QUEUE_DOCUMENT_TYPES),
    '',
    formatDocumentQueueAttention('Вторая очередь', summary.documentsMissing, SECOND_QUEUE_DOCUMENT_TYPES),
    '',
    `Не заполнили статистику за 7 дней (${summary.weekStart} - ${summary.weekEnd}): ${formatIntegerRu(
      summary.weeklyStatsAttention.length
    )}`,
    summary.weeklyStatsAttention.length
      ? summary.weeklyStatsAttention.map(formatWeeklyStatusLine).join('\n')
      : '• Нет',
    '',
    `Не указали количество видео за ${summary.monthKey}: ${formatIntegerRu(summary.monthlyVideoMissing.length)}`,
    summary.monthlyVideoMissing.length
      ? summary.monthlyVideoMissing.map(formatMonthlyVideoStatusLine).join('\n')
      : '• Нет'
  ].join('\n');

export const formatAdminAttentionSummary = (summary: TeamLeadAttentionSummary) =>
  formatTeamLeadAttentionSummary(summary)
    .replace('Требует внимания по группе', 'Требует внимания по всем креаторам')
    .replace('Креаторов в группе:', 'Креаторов всего:');

export const formatAdminDashboardSummary = (summary: AdminDashboardSummary) =>
  [
    `Сводка администратора за ${summary.monthKey}`,
    '',
    `Активные креаторы: ${formatIntegerRu(summary.activeCreators)}`,
    `Тимлиды: ${formatIntegerRu(summary.teamLeads)}`,
    `Недельные отчеты отправлены: ${formatIntegerRu(summary.weeklyReportsSubmitted)}`,
    `Недельные отчеты отсутствуют: ${formatIntegerRu(summary.weeklyReportsAbsent)}`,
    `Месячные видео указаны: ${formatIntegerRu(summary.monthlyVideosSubmitted)}`,
    `Месячные видео не указаны: ${formatIntegerRu(summary.monthlyVideosMissing)}`,
    `Документы сгенерированы: ${formatIntegerRu(summary.documentsGenerated)}`,
    `Документы подписаны: ${formatIntegerRu(summary.documentsSigned)}`,
    `Документы не возвращены: ${formatIntegerRu(summary.documentsNotReturned)}`,
    `Сумма выплат: ${formatMoneyRu(summary.totalPayment)}`
  ].join('\n');

export const formatBulkOperationResult = (result: BulkOperationResult) =>
  [
    `Массовая операция: ${result.operation}`,
    '',
    `Всего: ${formatIntegerRu(result.total)}`,
    `Успешно: ${formatIntegerRu(result.success)}`,
    `Ошибок: ${formatIntegerRu(result.failed)}`,
    `Пропущено: ${formatIntegerRu(result.skipped)}`,
    '',
    result.details.length ? result.details.slice(0, 20).join('\n') : 'Без деталей'
  ].join('\n');
