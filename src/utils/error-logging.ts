type PlainLogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | PlainLogValue[]
  | { [key: string]: PlainLogValue };

const MAX_DEPTH = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toPlainLogValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): PlainLogValue => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (depth >= MAX_DEPTH) {
    return '[MaxDepth]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => toPlainLogValue(item, seen, depth + 1));
  }

  const output: Record<string, PlainLogValue> = {};

  for (const key of Object.keys(value)) {
    output[key] = toPlainLogValue(value[key], seen, depth + 1);
  }

  return output;
};

const pickErrorProperty = (error: Error, key: string) =>
  toPlainLogValue((error as Error & Record<string, unknown>)[key]);

export const normalizeErrorForLog = (error: unknown): Record<string, PlainLogValue> => {
  if (error instanceof Error) {
    const normalized: Record<string, PlainLogValue> = {
      type: 'Error',
      name: error.name,
      message: error.message,
      stack: error.stack
    };
    const knownExtraKeys = ['code', 'meta', 'cause'];

    for (const key of knownExtraKeys) {
      if (key in error) {
        normalized[key] =
          key === 'cause'
            ? normalizeErrorForLog((error as Error & { cause?: unknown }).cause)
            : pickErrorProperty(error, key);
      }
    }

    const extra: Record<string, PlainLogValue> = {};

    for (const key of Object.keys(error)) {
      if (!['name', 'message', 'stack', ...knownExtraKeys].includes(key)) {
        extra[key] = pickErrorProperty(error, key);
      }
    }

    if (Object.keys(extra).length > 0) {
      normalized.extra = extra;
    }

    return normalized;
  }

  if (typeof error === 'string') {
    return {
      type: 'string',
      message: error
    };
  }

  if (isRecord(error)) {
    return {
      type: 'object',
      payload: toPlainLogValue(error)
    };
  }

  return {
    type: typeof error,
    payload: toPlainLogValue(error)
  };
};
