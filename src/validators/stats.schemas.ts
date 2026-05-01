import { z } from 'zod';

import { MAX_KPI_VIEWS } from '../utils/kpi-limits';

const normalizeIntegerInput = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().replace(/[\s\u00a0]+/g, '');

  if (!normalized) {
    return undefined;
  }

  return Number(normalized);
};

export const nonNegativeIntSchema = z.preprocess(
  normalizeIntegerInput,
  z
    .number({
      required_error: 'Нужно ввести число',
      invalid_type_error: 'Нужно ввести число'
    })
    .int('Введи целое число')
    .min(0, 'Число не может быть отрицательным')
);

export const kpiViewsSchema = nonNegativeIntSchema.refine(
  (value) => value <= MAX_KPI_VIEWS,
  'KPI/охват не может быть больше 15 000 000.'
);

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Используй формат YYYY-MM');
