const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readRecord = (value: unknown, key: string) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
};

const readString = (value: unknown, key: string) => {
  if (!isRecord(value)) {
    return '';
  }

  const property = value[key];
  return typeof property === 'string' ? property : '';
};

const readNumber = (value: unknown, key: string) => {
  if (!isRecord(value)) {
    return null;
  }

  const property = value[key];
  return typeof property === 'number' ? property : null;
};

const getTelegramErrorCode = (error: unknown) =>
  readNumber(error, 'code') ??
  readNumber(readRecord(error, 'response'), 'error_code') ??
  readNumber(readRecord(readRecord(error, 'extra'), 'response'), 'error_code');

const getTelegramErrorDescription = (error: unknown) =>
  [
    error instanceof Error ? error.message : '',
    readString(error, 'description'),
    readString(readRecord(error, 'response'), 'description'),
    readString(readRecord(readRecord(error, 'extra'), 'response'), 'description')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export const isTelegramDirectMessageUnavailableError = (error: unknown) => {
  if (getTelegramErrorCode(error) !== 403) {
    return false;
  }

  const description = getTelegramErrorDescription(error);

  return [
    "bot can't initiate conversation with a user",
    'bot was blocked by the user',
    'user is deactivated',
    'chat not found'
  ].some((marker) => description.includes(marker));
};
