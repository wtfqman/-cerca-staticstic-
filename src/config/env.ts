import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import cron from 'node-cron';
import { z } from 'zod';

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');
const TELEGRAM_ID_PATTERN = /^-?\d+$/;
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const failConfig = (message: string): never => {
  console.error(`\n[config] ${message}\n`);
  throw new Error('Invalid environment configuration');
};

const parseOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
};

const optionalStringSchema = z.preprocess(parseOptionalString, z.string().optional());
const optionalEmailSchema = z.preprocess(parseOptionalString, z.string().email().optional());

const normalizeSpreadsheetId = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();

  if (normalized === '') {
    return undefined;
  }

  const match = normalized.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);

  return match?.[1] ?? normalized;
};

const optionalSpreadsheetIdSchema = z.preprocess(
  normalizeSpreadsheetId,
  z
    .string()
    .regex(
      SPREADSHEET_ID_PATTERN,
      'GOOGLE_SHEETS_SPREADSHEET_ID must be a Google spreadsheet ID or a full Google Sheets URL'
    )
    .optional()
);

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === '') {
      return undefined;
    }

    if (TRUE_VALUES.has(normalized)) {
      return true;
    }

    if (FALSE_VALUES.has(normalized)) {
      return false;
    }

    return value;
  }, z.boolean().default(defaultValue));

const optionalBooleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === '') {
    return undefined;
  }

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return value;
}, z.boolean().optional());

const intFromEnv = (defaultValue: number, options: { min?: number; max?: number } = {}) => {
  let schema = z.number().int();

  if (options.min !== undefined) {
    schema = schema.min(options.min);
  }

  if (options.max !== undefined) {
    schema = schema.max(options.max);
  }

  return z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim();

    if (normalized === '') {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? value : parsed;
  }, schema.default(defaultValue));
};

const requiredCronSchema = z
  .string()
  .trim()
  .min(1, 'Cron expression must not be empty')
  .refine((value) => cron.validate(value), 'Invalid cron expression');

const optionalCronSchema = z.preprocess(
  parseOptionalString,
  z
    .string()
    .refine((value) => cron.validate(value), 'Invalid cron expression')
    .optional()
);

const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'TZ must not be empty')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');

const parseTelegramIdList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizePrivateKey = (value?: string) => value?.replace(/\\n/g, '\n');

const resolveOptionalExecutable = (value?: string) => {
  if (!value) {
    return undefined;
  }

  return path.isAbsolute(value) || /[\\/]/.test(value) ? path.resolve(process.cwd(), value) : value;
};

const dotenvResult = dotenv.config();

if (dotenvResult.error) {
  const error = dotenvResult.error as NodeJS.ErrnoException;

  if (error.code !== 'ENOENT') {
    failConfig(`Failed to load ${ENV_FILE_PATH}: ${error.message}`);
  }
}

if (!process.env.STORAGE_ROOT && process.env.STORAGE_DIR?.trim()) {
  console.warn('[config] STORAGE_DIR is deprecated. Use STORAGE_ROOT instead.');
}

const envSource = {
  ...process.env,
  STORAGE_ROOT: process.env.STORAGE_ROOT ?? process.env.STORAGE_DIR
};

const rawEnvSchema = z
  .object({
    BOT_TOKEN: z
      .string()
      .trim()
      .regex(BOT_TOKEN_PATTERN, 'BOT_TOKEN must look like a valid Telegram bot token'),
    DATABASE_URL: z.string().trim().url('DATABASE_URL must be a valid URL'),
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ADMIN_TELEGRAM_IDS: z.string().default(''),
    TZ: timezoneSchema.default('Europe/Moscow'),
    DAILY_REMINDER_CRON: requiredCronSchema.default('0 21 * * 1-6'),
    DAILY_MISSED_CHECK_CRON: requiredCronSchema.default('0 22 * * 1-6'),
    WEEKLY_STATS_CRON: requiredCronSchema.default('0 10 * * 1'),
    WEEKLY_STATS_REMINDER_CRON: requiredCronSchema.default('0 12,15,18,20 * * 1'),
    WEEKLY_STATS_TEAMLEAD_REPORT_CRON: requiredCronSchema.default('0 21 * * 1'),
    DOCUMENT_RECEIPT_REMINDER_CRON: requiredCronSchema.default('0 * * * *'),
    DOCUMENTS_CHAT_ID: optionalStringSchema.refine(
      (value) => !value || TELEGRAM_ID_PATTERN.test(value),
      'DOCUMENTS_CHAT_ID must be a Telegram chat ID'
    ),
    STORAGE_ROOT: z.string().trim().min(1).default('./storage'),
    PDF_FONT_FAMILY: z.string().trim().min(1).default('DejaVu Sans'),
    PDF_BROWSER_TIMEOUT_MS: intFromEnv(30000, { min: 1 }),
    PDF_HEADLESS: booleanFromEnv(true),
    PDF_EXECUTABLE_PATH: optionalStringSchema,
    LIBREOFFICE_EXECUTABLE_PATH: optionalStringSchema,
    DOCX_PDF_HTML_FALLBACK_ENABLED: optionalBooleanFromEnv,
    MAX_MONTHLY_VIDEO_EDIT_DAY: intFromEnv(10, { min: 1, max: 31 }),
    GOOGLE_SHEETS_SYNC_ENABLED: booleanFromEnv(false),
    GOOGLE_SHEETS_SPREADSHEET_ID: optionalSpreadsheetIdSchema,
    GOOGLE_SHEETS_STATS_SHEET_NAME: z.string().trim().min(1).default('Статистика'),
    GOOGLE_SHEETS_PAYMENTS_SHEET_NAME: z.string().trim().min(1).default('Выплаты'),
    GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME: z.string().trim().min(1).default('Документы'),
    GOOGLE_SHEETS_BATCH_SIZE: intFromEnv(500, { min: 50, max: 5000 }),
    GOOGLE_SHEETS_NIGHTLY_SYNC_CRON: optionalCronSchema,
    GOOGLE_APPLICATION_CREDENTIALS: optionalStringSchema,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalEmailSchema,
    GOOGLE_PRIVATE_KEY: optionalStringSchema,
    COMPANY_NAME: z.string().trim().min(1).default('Заказчик'),
    COMPANY_SHORT_NAME: z.string().trim().min(1).default('Заказчик'),
    COMPANY_REPRESENTATIVE: z.string().trim().min(1).default('Уполномоченный представитель'),
    COMPANY_REPRESENTATIVE_BASIS: z
      .string()
      .trim()
      .min(1)
      .default('действующего на основании доверенности'),
    COMPANY_ADDRESS: z.string().trim().min(1).default('Юридический адрес заказчика'),
    COMPANY_INN: z.string().trim().min(1).default('0000000000'),
    COMPANY_BANK_NAME: z.string().trim().min(1).default('Банк заказчика'),
    COMPANY_BANK_ACCOUNT: z.string().trim().min(1).default('00000000000000000000'),
    COMPANY_BANK_BIK: z.string().trim().min(1).default('000000000'),
    COMPANY_BANK_CORR_ACCOUNT: z.string().trim().min(1).default('00000000000000000000'),
    COMPANY_EMAIL: z.string().trim().email().default('documents@example.com')
  })
  .superRefine((value, ctx) => {
    const invalidAdminIds = parseTelegramIdList(value.ADMIN_TELEGRAM_IDS).filter(
      (id) => !TELEGRAM_ID_PATTERN.test(id)
    );

    if (invalidAdminIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_TELEGRAM_IDS'],
        message: `Invalid Telegram IDs: ${invalidAdminIds.join(', ')}`
      });
    }

    if (!value.GOOGLE_SHEETS_SYNC_ENABLED) {
      return;
    }

    if (!value.GOOGLE_SHEETS_SPREADSHEET_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_SHEETS_SPREADSHEET_ID'],
        message: 'GOOGLE_SHEETS_SPREADSHEET_ID is required when Google Sheets sync is enabled'
      });
    }

    const hasCredentialsFile = Boolean(value.GOOGLE_APPLICATION_CREDENTIALS);
    const hasServiceAccountEmail = Boolean(value.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    const hasPrivateKey = Boolean(value.GOOGLE_PRIVATE_KEY);

    if (!hasCredentialsFile && !hasServiceAccountEmail && !hasPrivateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_APPLICATION_CREDENTIALS'],
        message:
          'When GOOGLE_SHEETS_SYNC_ENABLED=true, configure GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY'
      });
    }

    if (hasCredentialsFile) {
      const credentialsPath = path.resolve(process.cwd(), value.GOOGLE_APPLICATION_CREDENTIALS!);

      if (!fs.existsSync(credentialsPath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_APPLICATION_CREDENTIALS'],
          message: `Credentials file not found: ${credentialsPath}`
        });
      }
    }

    if (!hasCredentialsFile && hasServiceAccountEmail !== hasPrivateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasServiceAccountEmail ? ['GOOGLE_PRIVATE_KEY'] : ['GOOGLE_SERVICE_ACCOUNT_EMAIL'],
        message:
          'GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be provided together when using env-based Google auth'
      });
    }
  });

let rawEnv: z.infer<typeof rawEnvSchema>;

try {
  rawEnv = rawEnvSchema.parse(envSource);
} catch (error) {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((issue) => {
        const key = issue.path.join('.') || 'env';
        return `- ${key}: ${issue.message}`;
      })
      .join('\n');

    failConfig(`Environment validation failed:\n${details}`);
  }

  throw error;
}

const googleAuthMode = !rawEnv.GOOGLE_SHEETS_SYNC_ENABLED
  ? 'disabled'
  : rawEnv.GOOGLE_APPLICATION_CREDENTIALS
    ? 'application_credentials'
    : 'service_account_env';

export const env = Object.freeze({
  BOT_TOKEN: rawEnv.BOT_TOKEN,
  DATABASE_URL: rawEnv.DATABASE_URL,
  APP_ENV: rawEnv.APP_ENV,
  LOG_LEVEL: rawEnv.LOG_LEVEL,
  ADMIN_TELEGRAM_IDS: Array.from(new Set(parseTelegramIdList(rawEnv.ADMIN_TELEGRAM_IDS))),
  TZ: rawEnv.TZ,
  DAILY_REMINDER_CRON: rawEnv.DAILY_REMINDER_CRON,
  DAILY_MISSED_CHECK_CRON: rawEnv.DAILY_MISSED_CHECK_CRON,
  WEEKLY_STATS_CRON: rawEnv.WEEKLY_STATS_CRON,
  WEEKLY_STATS_REMINDER_CRON: rawEnv.WEEKLY_STATS_REMINDER_CRON,
  WEEKLY_STATS_TEAMLEAD_REPORT_CRON: rawEnv.WEEKLY_STATS_TEAMLEAD_REPORT_CRON,
  DOCUMENT_RECEIPT_REMINDER_CRON: rawEnv.DOCUMENT_RECEIPT_REMINDER_CRON,
  DOCUMENTS_CHAT_ID: rawEnv.DOCUMENTS_CHAT_ID ?? null,
  STORAGE_ROOT: path.resolve(process.cwd(), rawEnv.STORAGE_ROOT),
  PDF_FONT_FAMILY: rawEnv.PDF_FONT_FAMILY,
  PDF_BROWSER_TIMEOUT_MS: rawEnv.PDF_BROWSER_TIMEOUT_MS,
  PDF_HEADLESS: rawEnv.PDF_HEADLESS,
  PDF_EXECUTABLE_PATH: rawEnv.PDF_EXECUTABLE_PATH
    ? path.resolve(process.cwd(), rawEnv.PDF_EXECUTABLE_PATH)
    : undefined,
  LIBREOFFICE_EXECUTABLE_PATH: resolveOptionalExecutable(rawEnv.LIBREOFFICE_EXECUTABLE_PATH),
  DOCX_PDF_HTML_FALLBACK_ENABLED:
    rawEnv.DOCX_PDF_HTML_FALLBACK_ENABLED ?? false,
  MAX_MONTHLY_VIDEO_EDIT_DAY: rawEnv.MAX_MONTHLY_VIDEO_EDIT_DAY,
  GOOGLE_SHEETS_SYNC_ENABLED: rawEnv.GOOGLE_SHEETS_SYNC_ENABLED,
  GOOGLE_SHEETS_SPREADSHEET_ID: rawEnv.GOOGLE_SHEETS_SPREADSHEET_ID,
  GOOGLE_SHEETS_STATS_SHEET_NAME: rawEnv.GOOGLE_SHEETS_STATS_SHEET_NAME,
  GOOGLE_SHEETS_PAYMENTS_SHEET_NAME: rawEnv.GOOGLE_SHEETS_PAYMENTS_SHEET_NAME,
  GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME: rawEnv.GOOGLE_SHEETS_DOCUMENTS_SHEET_NAME,
  GOOGLE_SHEETS_BATCH_SIZE: rawEnv.GOOGLE_SHEETS_BATCH_SIZE,
  GOOGLE_SHEETS_NIGHTLY_SYNC_CRON: rawEnv.GOOGLE_SHEETS_NIGHTLY_SYNC_CRON,
  GOOGLE_APPLICATION_CREDENTIALS: rawEnv.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.cwd(), rawEnv.GOOGLE_APPLICATION_CREDENTIALS)
    : undefined,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: rawEnv.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: normalizePrivateKey(rawEnv.GOOGLE_PRIVATE_KEY),
  GOOGLE_SHEETS_AUTH_MODE: googleAuthMode,
  COMPANY_NAME: rawEnv.COMPANY_NAME,
  COMPANY_SHORT_NAME: rawEnv.COMPANY_SHORT_NAME,
  COMPANY_REPRESENTATIVE: rawEnv.COMPANY_REPRESENTATIVE,
  COMPANY_REPRESENTATIVE_BASIS: rawEnv.COMPANY_REPRESENTATIVE_BASIS,
  COMPANY_ADDRESS: rawEnv.COMPANY_ADDRESS,
  COMPANY_INN: rawEnv.COMPANY_INN,
  COMPANY_BANK_NAME: rawEnv.COMPANY_BANK_NAME,
  COMPANY_BANK_ACCOUNT: rawEnv.COMPANY_BANK_ACCOUNT,
  COMPANY_BANK_BIK: rawEnv.COMPANY_BANK_BIK,
  COMPANY_BANK_CORR_ACCOUNT: rawEnv.COMPANY_BANK_CORR_ACCOUNT,
  COMPANY_EMAIL: rawEnv.COMPANY_EMAIL
});

export type Env = typeof env;
export type GoogleSheetsAuthMode = Env['GOOGLE_SHEETS_AUTH_MODE'];
