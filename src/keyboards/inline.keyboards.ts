import { DocumentStatus, DocumentType, SocialPlatform } from '@prisma/client';
import { Markup } from 'telegraf';

import { formatDocumentUploadPrompt } from '../documents/document.formatters';
import type { CreatorProfileEditableField } from '../services/creator-profile.service';
import type { WeeklyReportReviewSummary } from '../types/report.types';
import { NO_CONTRACT_REGISTRATION_VALUE } from '../utils/creator-registration-mode';

export const buildDailyCheckInlineKeyboard = (checkId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Да', `daily_confirm:${checkId}`),
      Markup.button.callback('Отмечу позже', `daily_later:${checkId}`)
    ]
  ]);

export const legalTypeInlineKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Самозанятый', 'register_legal:SELF_EMPLOYED'),
      Markup.button.callback('ИП', 'register_legal:IP')
    ],
    [
      Markup.button.callback('Я без договора', `register_legal:${NO_CONTRACT_REGISTRATION_VALUE}`)
    ]
  ]);

export const weeklyPlatformsKeyboard = (includeFinish = false) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Instagram', `weekly_platform:${SocialPlatform.INSTAGRAM}`),
      Markup.button.callback('TikTok', `weekly_platform:${SocialPlatform.TIKTOK}`)
    ],
    [
      Markup.button.callback('VK', `weekly_platform:${SocialPlatform.VK}`),
      Markup.button.callback('YouTube', `weekly_platform:${SocialPlatform.YOUTUBE}`)
    ],
    ...(includeFinish ? [[Markup.button.callback('Завершить отчет', 'weekly_finish')]] : [])
  ]);

export const weeklyPlatformSkipKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('Пропустить платформу', 'weekly_platform_skip')]]);

export const reportMonthKeyboard = (currentMonthKey: string, previousMonthKey: string, prefix: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`Текущий месяц (${currentMonthKey})`, `${prefix}:${currentMonthKey}`)],
    [Markup.button.callback(`Прошлый месяц (${previousMonthKey})`, `${prefix}:${previousMonthKey}`)]
  ]);

export const adminStatsMonthKeyboard = (currentMonthKey: string, previousMonthKey: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`Общая сводка (${currentMonthKey})`, `admin_dashboard:${currentMonthKey}`)],
    [Markup.button.callback(`Команды (${currentMonthKey})`, `admin_stats_teams:${currentMonthKey}`)],
    [Markup.button.callback(`Общая сводка (${previousMonthKey})`, `admin_dashboard:${previousMonthKey}`)],
    [Markup.button.callback(`Команды (${previousMonthKey})`, `admin_stats_teams:${previousMonthKey}`)]
  ]);

const reviewableWeeklyReportStatuses = new Set(['SUBMITTED', 'CONFIRMED']);

export const weeklyReportReviewKeyboard = (
  reports: WeeklyReportReviewSummary[],
  options: { includeReviewButtons?: boolean } = {}
) => {
  const includeReviewButtons = options.includeReviewButtons ?? true;
  const reviewableReports = reports.filter(
    (report) => reviewableWeeklyReportStatuses.has(report.status) && !report.isReviewedByTeamLead
  );
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  if (includeReviewButtons) {
    rows.push(
      ...reviewableReports.map((report) => [
        Markup.button.callback(
          `Статистику проверил: ${report.weekStart} - ${report.weekEnd}`,
          `teamlead_weekly_review:${report.reportId}`
        )
      ])
    );
  }

  rows.push(
    ...reports
      .filter((report) => report.attachmentCount > 0)
      .map((report) => [
        Markup.button.callback(
          `Скрины: ${report.weekStart} - ${report.weekEnd} (${report.attachmentCount})`,
          `weekly_stat_attachments:${report.reportId}`
        )
      ])
  );

  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
};

export const monthlyVideoMonthKeyboard = (currentMonthKey: string, previousMonthKey: string) =>
  reportMonthKeyboard(currentMonthKey, previousMonthKey, 'monthly_video_month');

export const monthlyVideoReminderKeyboard = (monthKey: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`Указать количество видео за ${monthKey}`, `creator_monthly_video_reminder:${monthKey}`)]
  ]);

export const adminMissingMonthlyVideosKeyboard = (monthKey: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`Напомнить указать видео за ${monthKey}`, `admin_bulk_month:remind_monthly_videos:${monthKey}`)]
  ]);

export const documentGenerationMonthKeyboard = (currentMonthKey: string, previousMonthKey: string) =>
  reportMonthKeyboard(currentMonthKey, previousMonthKey, 'document_generate_month');

export const activeRosterFirstQueueKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Сформировать первую очередь', 'document_generate_first_queue')],
    [Markup.button.callback('Отправить подписанный PDF', 'document_upload_start')]
  ]);

export const activeRosterSecondQueueKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Сформировать акты и передачу прав', 'document_generate_second_queue')],
    [Markup.button.callback('Загрузить счет на оплату', 'payment_invoice_upload_start')],
    [Markup.button.callback('Загрузить чек', 'payment_receipt_upload_start')],
    [Markup.button.callback('Отправить подписанный PDF', 'document_upload_start')]
  ]);

export const creatorFirstQueueActionsKeyboard = (input: {
  hasGeneratedDocuments: boolean;
  hasAvailableDocuments: boolean;
}) =>
  Markup.inlineKeyboard([
    ...(!input.hasGeneratedDocuments
      ? [[Markup.button.callback('Сформировать первую очередь', 'document_generate_first_queue')]]
      : [
          [Markup.button.callback('Отправить подписанный PDF', 'document_upload_start')],
          ...(input.hasAvailableDocuments
            ? [[Markup.button.callback('Прислать все мои документы', 'document_resend_all')]]
            : [])
        ])
  ]);

export const creatorSecondQueueActionsKeyboard = (input: {
  isCompleted: boolean;
  hasGeneratedDocuments: boolean;
  hasAvailableDocuments: boolean;
}) => {
  if (input.isCompleted) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Выставить счет', 'payment_invoice_upload_start')],
      [Markup.button.callback('Загрузить чек', 'payment_receipt_upload_start')],
      ...(input.hasAvailableDocuments
        ? [[Markup.button.callback('Прислать все мои документы', 'document_resend_all')]]
        : [])
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback('Сформировать/обновить акты и передачу прав', 'document_generate_second_queue')],
    ...(input.hasGeneratedDocuments
      ? [[Markup.button.callback('Отправить подписанный PDF', 'document_upload_start')]]
      : []),
    ...(input.hasAvailableDocuments
      ? [[Markup.button.callback('Прислать все мои документы', 'document_resend_all')]]
      : [])
  ]);
};

export const noContractCreatorPaymentKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Выставить счет', 'payment_invoice_upload_start')],
    [Markup.button.callback('Загрузить чек', 'payment_receipt_upload_start')]
  ]);

export const paymentInvoiceMonthKeyboard = (monthKeys: string[]) =>
  Markup.inlineKeyboard(
    monthKeys.map((monthKey) => [
      Markup.button.callback(`Счет за ${monthKey}`, `payment_invoice_month:${monthKey}`)
    ])
  );

export const paymentReceiptMonthKeyboard = (monthKeys: string[]) =>
  Markup.inlineKeyboard(
    monthKeys.map((monthKey) => [
      Markup.button.callback(`Чек за ${monthKey}`, `payment_receipt_month:${monthKey}`)
    ])
  );

export const confirmInlineKeyboard = (confirmData: string, editData: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Подтвердить', confirmData),
      Markup.button.callback('Изменить', editData)
    ]
  ]);

export const approvalInlineKeyboard = (confirmData: string, cancelData = 'action_cancel') =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Подтвердить', confirmData),
      Markup.button.callback('Отмена', cancelData)
    ]
  ]);

const profileEditLabels: Record<CreatorProfileEditableField, string> = {
  fullName: 'ФИО',
  contractDeadlineDate: 'Срок договора',
  registrationAddress: 'Адрес регистрации',
  inn: 'ИНН',
  bankAccount: 'Расч. счет',
  bankName: 'Банк',
  bankBik: 'БИК',
  bankCorrAccount: 'Корр. счет',
  phone: 'Телефон',
  email: 'Email',
  passportSeries: 'Серия паспорта',
  passportNumber: 'Номер паспорта',
  passportIssuedAt: 'Дата выдачи паспорта',
  passportIssuedByInstrumental: 'Кем выдан паспорт',
  passportDepartmentCode: 'Код подразделения',
  ogrnip: 'ОГРНИП'
};

export const profileEditFieldKeyboard = (fields: CreatorProfileEditableField[]) =>
  Markup.inlineKeyboard(
    fields.reduce<Array<Array<ReturnType<typeof Markup.button.callback>>>>((rows, field, index) => {
      if (index % 2 === 0) {
        rows.push([]);
      }

      rows[rows.length - 1].push(Markup.button.callback(profileEditLabels[field], `profile_edit_field:${field}`));
      return rows;
    }, [])
  );

export const creatorProfileSelfEditKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Запросить изменение данных', 'profile_change_request_start')]
  ]);

export const profileChangeRequestFieldKeyboard = (fields: CreatorProfileEditableField[]) =>
  Markup.inlineKeyboard([
    ...fields.map((field) => [
      Markup.button.callback(profileEditLabels[field], `profile_change_request_field:${field}`)
    ]),
    [Markup.button.callback('Отмена', 'profile_change_request_cancel')]
  ]);

export const profileChangeRequestDecisionKeyboard = (requestId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('Подтвердить', `profile_change_request_approve:${requestId}`),
      Markup.button.callback('Отклонить', `profile_change_request_reject:${requestId}`)
    ]
  ]);

export const creatorProfileActionsKeyboard = (input: {
  reportCallbackData: string;
  editCallbackData: string;
  assignTeamLeadCallbackData?: string;
}) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Показать отчет', input.reportCallbackData)],
    [Markup.button.callback('Изменить данные', input.editCallbackData)],
    ...(input.assignTeamLeadCallbackData
      ? [[Markup.button.callback('Назначить тимлида', input.assignTeamLeadCallbackData)]]
      : [])
  ]);

export const documentSelectionKeyboard = (
  documents: Array<{
    id: string;
    type: DocumentType;
    monthKey: string | null;
    scopeKey?: string | null;
    status?: DocumentStatus;
    signedUploadedAt?: Date | null;
  }>
) =>
  Markup.inlineKeyboard(
    documents.map((document) => [
      Markup.button.callback(
        formatDocumentUploadPrompt(document),
        `document_upload_pick:${document.id}`
      )
    ])
  );

export const documentListKeyboard = (
  documents: Array<{
    id: string;
    type: DocumentType;
    monthKey: string | null;
    scopeKey?: string | null;
  }>
) =>
  Markup.inlineKeyboard(
    documents.map((document) => [
      Markup.button.callback(
        formatDocumentUploadPrompt(document),
        `document_resend:${document.id}`
      )
    ])
  );

export const entitySelectionKeyboard = (
  prefix: string,
  items: Array<{ id: string; label: string }>,
  page = 0,
  pageSize = 8
) => {
  const startIndex = page * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const navigationRow = [];

  if (page > 0) {
    navigationRow.push(Markup.button.callback('← Назад', `${prefix}:page:${page - 1}`));
  }

  if (page < pageCount - 1) {
    navigationRow.push(Markup.button.callback('Дальше →', `${prefix}:page:${page + 1}`));
  }

  return Markup.inlineKeyboard([
    ...pageItems.map((item) => [Markup.button.callback(item.label, `${prefix}:pick:${item.id}`)]),
    ...(navigationRow.length ? [navigationRow] : [])
  ]);
};

export const creatorReportsKeyboard = (currentMonthKey: string, previousMonthKey: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`Отчет за ${currentMonthKey}`, `creator_month_report:${currentMonthKey}`)],
    [Markup.button.callback(`Отчет за ${previousMonthKey}`, `creator_month_report:${previousMonthKey}`)],
    [Markup.button.callback('Сводка за последние 7 дней', 'creator_week_report')]
  ]);

export const googleSheetsMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Синхронизировать статистику', 'admin_sheets_sync:stats')],
    [Markup.button.callback('Синхронизировать соцсети', 'admin_sheets_sync:socials')],
    [Markup.button.callback('Синхронизировать выплаты', 'admin_sheets_sync:payments')],
    [Markup.button.callback('Синхронизировать документы', 'admin_sheets_sync:documents')],
    [Markup.button.callback('Синхронизировать все', 'admin_sheets_sync:all')],
    [Markup.button.callback('Пересобрать лист', 'admin_sheets_rebuild_menu')],
    [Markup.button.callback('Проверить таблицу', 'admin_sheets_test')]
  ]);

export const googleSheetsRebuildKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Пересобрать лист статистики', 'admin_sheets_rebuild:stats')],
    [Markup.button.callback('Пересобрать лист соцсетей', 'admin_sheets_rebuild:socials')],
    [Markup.button.callback('Пересобрать лист выплат', 'admin_sheets_rebuild:payments')],
    [Markup.button.callback('Пересобрать лист документов', 'admin_sheets_rebuild:documents')]
  ]);

export const adminCreatorsActionsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Выдать доступ креатора', 'admin_creator_access_start')],
    [Markup.button.callback('Запретить доступ креатора', 'admin_creator_access_revoke_start')],
    [Markup.button.callback('Вернуть доступ креатора', 'admin_creator_access_restore_start')]
  ]);

export const adminGroupActionsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Назначить креатора тимлиду', 'admin_group_assign_start')]
  ]);

export const adminBulkActionsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Напомнить по недельной статистике', 'admin_bulk:remind_weekly_stats')],
    [Markup.button.callback('Напомнить по количеству видео', 'admin_bulk:remind_monthly_videos')],
    [Markup.button.callback('Напомнить по документам', 'admin_bulk:remind_documents')],
    [Markup.button.callback('Сгенерировать первую очередь', 'admin_bulk:generate_first_queue')],
    [Markup.button.callback('Сгенерировать вторую очередь', 'admin_bulk:generate_second_queue')],
    [Markup.button.callback('Жду чеки', 'admin_bulk:await_receipts')],
    [Markup.button.callback('Сгенерировать задания за месяц', 'admin_bulk:generate_documents')],
    [Markup.button.callback('Синхронизировать выплаты за месяц', 'admin_bulk:sync_payments')],
    [Markup.button.callback('Синхронизировать документы для всех', 'admin_bulk:sync_documents')]
  ]);
