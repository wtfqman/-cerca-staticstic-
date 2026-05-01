import { z } from 'zod';

export const pdfMimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value === 'application/pdf', 'Нужен PDF-файл');
