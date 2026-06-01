import { z } from 'zod';

import { logger } from '../lib/logger';
import { normalizeErrorForLog } from './error-logging';

const DEFAULT_VALIDATION_MESSAGE = 'Проверь значение и попробуй еще раз.';
const DEFAULT_TECHNICAL_MESSAGE =
  'Сейчас не удалось выполнить это действие. Попробуй еще раз немного позже.';

const technicalMessagePatterns = [
  /^\s*[\[{]/,
  /\b(invalid_type|invalid_string|received|expected|issues|stack|path)\b/i,
  /\b(Prisma|P\d{4}|Unique constraint|Foreign key|ZodError|ValidationError)\b/i,
  /\b(ENOENT|EACCES|ECONN|ETIMEDOUT|fetch failed|timeout)\b/i,
  /\b(Playwright|Chromium|browser|node_modules)\b/i,
  /\b(not configured|not found after|must be|expects|service is not configured)\b/i,
  /\b(Cannot read|Cannot destructure|undefined|null|NaN)\b/i,
  /\b(chatId|monthKey|creatorUserId|telegramFileId)\b/,
  /\b[A-Z0-9]+_[A-Z0-9_]+\b/
];

const normalizeUserMessage = (message: string) => message.trim().replace(/\s+/g, ' ');

const isTechnicalMessage = (message: string) =>
  technicalMessagePatterns.some((pattern) => pattern.test(message));

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export const isUserFacingError = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return true;
  }

  const message = getErrorMessage(error);

  return Boolean(message && !isTechnicalMessage(message));
};

export const formatValidationError = (
  error: unknown,
  fallback = DEFAULT_VALIDATION_MESSAGE
) => {
  if (!(error instanceof z.ZodError)) {
    const message = getErrorMessage(error);
    return message && !isTechnicalMessage(message) ? normalizeUserMessage(message) : fallback;
  }

  const issue = error.issues[0];

  if (!issue) {
    return fallback;
  }

  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.expected === 'number' || issue.received === 'nan') {
      return 'Нужно ввести число';
    }

    if (issue.received === 'undefined' || issue.received === 'null') {
      return 'Это поле нельзя оставить пустым';
    }

    return fallback;
  }

  if (
    issue.code === z.ZodIssueCode.too_small &&
    issue.type === 'string' &&
    issue.minimum === 1
  ) {
    return 'Это поле нельзя оставить пустым';
  }

  if (issue.code === z.ZodIssueCode.invalid_string && issue.validation === 'email') {
    return 'Введи корректный e-mail';
  }

  if (issue.code === z.ZodIssueCode.invalid_string && issue.validation === 'regex') {
    return issue.message && !isTechnicalMessage(issue.message)
      ? normalizeUserMessage(issue.message)
      : 'Проверь формат значения.';
  }

  return issue.message && !isTechnicalMessage(issue.message)
    ? normalizeUserMessage(issue.message)
    : fallback;
};

export const formatUserError = (
  error: unknown,
  fallback = DEFAULT_TECHNICAL_MESSAGE
) => {
  if (error instanceof z.ZodError) {
    return formatValidationError(error);
  }

  const message = getErrorMessage(error);

  return message && !isTechnicalMessage(message) ? normalizeUserMessage(message) : fallback;
};

export const logUserError = (
  error: unknown,
  message: string,
  context: Record<string, unknown> = {}
) => {
  const log = isUserFacingError(error) ? logger.warn.bind(logger) : logger.error.bind(logger);

  log(
    {
      error: normalizeErrorForLog(error),
      ...context
    },
    message
  );
};
