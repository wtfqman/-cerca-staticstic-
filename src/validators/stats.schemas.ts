import { z } from 'zod';

import { MAX_KPI_VIEWS } from '../utils/kpi-limits';

export const MAX_VIDEO_COUNT = 1000;

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

export const videoCountSchema = nonNegativeIntSchema.refine(
  (value) => value <= MAX_VIDEO_COUNT,
  `Количество видео не может быть больше ${MAX_VIDEO_COUNT}. Если это охваты/просмотры, внеси их в раздел охватов.`
);

export const kpiViewsSchema = nonNegativeIntSchema.refine(
  (value) => value <= MAX_KPI_VIEWS,
  'KPI/охват не может быть больше 15 000 000.'
);

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Используй формат YYYY-MM');
