import { env } from './env';

export const config = Object.freeze({
  bot: Object.freeze({
    token: env.BOT_TOKEN
  }),
  db: Object.freeze({
    url: env.DATABASE_URL
  }),
  app: Object.freeze({
    env: env.APP_ENV,
    logLevel: env.LOG_LEVEL,
    tz: env.TZ
  }),
  admin: Object.freeze({
    telegramIds: env.ADMIN_TELEGRAM_IDS
  }),
  cron: Object.freeze({
    dailyReminder: env.DAILY_REMINDER_CRON,
    dailyMissedCheck: env.DAILY_MISSED_CHECK_CRON,
    weeklyStats: env.WEEKLY_STATS_CRON,
    weeklyStatsReminder: env.WEEKLY_STATS_REMINDER_CRON,
    weeklyStatsTeamLeadReport: env.WEEKLY_STATS_TEAMLEAD_REPORT_CRON,
    documentReceiptReminder: env.DOCUMENT_RECEIPT_REMINDER_CRON,
    googleSheetsNightlySync: env.GOOGLE_SHEETS_NIGHTLY_SYNC_CRON ?? null
  }),
  documents: Object.freeze({
    chatId: env.DOCUMENTS_CHAT_ID,
    workflowMonthKey: env.DOCUMENT_WORKFLOW_MONTH_KEY ?? null,
    company: Object.freeze({
      name: env.COMPANY_NAME,
      shortName: env.COMPANY_SHORT_NAME,
      representative: env.COMPANY_REPRESENTATIVE,
      representativeBasis: env.COMPANY_REPRESENTATIVE_BASIS,
      address: env.COMPANY_ADDRESS,
      inn: env.COMPANY_INN,
      bankName: env.COMPANY_BANK_NAME,
      bankAccount: env.COMPANY_BANK_ACCOUNT,
      bankBik: env.COMPANY_BANK_BIK,
      bankCorrAccount: env.COMPANY_BANK_CORR_ACCOUNT,
      email: env.COMPANY_EMAIL
    })
  }),
  storage: Object.freeze({
    root: env.STORAGE_ROOT
  }),
  pdf: Object.freeze({
    fontFamily: env.PDF_FONT_FAMILY,
    browserTimeoutMs: env.PDF_BROWSER_TIMEOUT_MS,
    headless: env.PDF_HEADLESS,
    executablePath: env.PDF_EXECUTABLE_PATH ?? null,
    libreOfficeExecutablePath: env.LIBREOFFICE_EXECUTABLE_PATH ?? null,
    docxHtmlFallbackEnabled: env.DOCX_PDF_HTML_FALLBACK_ENABLED
  }),
  limits: Object.freeze({
    maxMonthlyVideoEditDay: env.MAX_MONTHLY_VIDEO_EDIT_DAY
  }),
  googleSheets: Object.freeze({
    enabled: env.GOOGLE_SHEETS_SYNC_ENABLED,
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID ?? null,
    batchSize: env.GOOGLE_SHEETS_BATCH_SIZE,
    authMode: env.GOOGLE_SHEETS_AUTH_MODE,
    applicationCredentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS ?? null,
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    privateKey: env.GOOGLE_PRIVATE_KEY ?? null,
    sheetNames: Object.freeze({
      socials: env.GOOGLE_SHEETS_SOCIALS_SHEET_NAME,
      stats: env.GOOGLE_SHEETS_STATS_SHEET_NAME,
      payments: env.GOOGLE_SHEETS_PAYMENTS_SHEET_NAME,
      documents: env.GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME
    })
  })
});

export type Config = typeof config;
export type AppEnv = Config['app']['env'];
export type GoogleSheetsAuthMode = Config['googleSheets']['authMode'];
