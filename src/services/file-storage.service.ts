import fs from 'node:fs/promises';
import path from 'node:path';

import { DocumentType, PaymentDocumentType } from '@prisma/client';

import { config } from '../config';
import { getDocumentBaseName, isMonthlyDocument } from '../documents/document.constants';

const sanitizeFileNamePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const sanitizeScopeDir = (value: string) => `scope_${sanitizeFileNamePart(value)}`;
const buildTimestamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export class FileStorageService {
  private readonly baseDir = config.storage.root;

  async ensureStorage() {
    await Promise.all([
      fs.mkdir(path.join(this.baseDir, 'generated'), { recursive: true }),
      fs.mkdir(path.join(this.baseDir, 'signed'), { recursive: true }),
      fs.mkdir(path.join(this.baseDir, 'weekly-stats'), { recursive: true }),
      fs.mkdir(path.join(this.baseDir, 'payment-documents'), { recursive: true }),
      fs.mkdir(path.join(this.baseDir, 'tmp'), { recursive: true })
    ]);
  }

  async saveGeneratedPdf(params: {
    creatorUserId: string;
    type: DocumentType;
    buffer: Buffer;
    monthKey?: string;
    scopeKey?: string;
  }) {
    const fileName = `${getDocumentBaseName(params.type)}.pdf`;
    const targetDir = params.scopeKey
      ? path.join(this.baseDir, 'generated', `creator_${params.creatorUserId}`, sanitizeScopeDir(params.scopeKey))
      : isMonthlyDocument(params.type)
      ? path.join(this.baseDir, 'generated', `creator_${params.creatorUserId}`, params.monthKey!)
      : path.join(this.baseDir, 'generated', `creator_${params.creatorUserId}`, getDocumentBaseName(params.type));

    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, fileName);
    await fs.writeFile(filePath, params.buffer);

    return {
      fileName,
      filePath
    };
  }

  async saveSignedPdf(params: {
    creatorUserId: string;
    type: DocumentType;
    buffer: Buffer;
    monthKey?: string;
    scopeKey?: string;
    uploadedAt?: Date;
  }) {
    const fileName = `${getDocumentBaseName(params.type)}_signed_${buildTimestamp(params.uploadedAt ?? new Date())}.pdf`;
    const targetDir = params.scopeKey
      ? path.join(this.baseDir, 'signed', `creator_${params.creatorUserId}`, sanitizeScopeDir(params.scopeKey))
      : isMonthlyDocument(params.type)
      ? path.join(this.baseDir, 'signed', `creator_${params.creatorUserId}`, params.monthKey!)
      : path.join(this.baseDir, 'signed', `creator_${params.creatorUserId}`, getDocumentBaseName(params.type));

    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, fileName);
    await fs.writeFile(filePath, params.buffer);

    return {
      fileName,
      filePath
    };
  }

  async saveWeeklyStatAttachment(params: {
    creatorUserId: string;
    weeklyReportId: string;
    buffer: Buffer;
    sortOrder: number;
    telegramFileUniqueId?: string | null;
  }) {
    const safeId = sanitizeFileNamePart(params.telegramFileUniqueId ?? `${Date.now()}`);
    const fileName = `${String(params.sortOrder).padStart(2, '0')}_${safeId}.jpg`;
    const targetDir = path.join(
      this.baseDir,
      'weekly-stats',
      `creator_${params.creatorUserId}`,
      `report_${params.weeklyReportId}`
    );

    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, fileName);
    await fs.writeFile(filePath, params.buffer);

    return {
      fileName,
      filePath
    };
  }

  async savePaymentDocument(params: {
    creatorUserId: string;
    workflowStateId: string;
    type: PaymentDocumentType;
    buffer: Buffer;
    monthKey?: string;
    originalFileName?: string;
  }) {
    const extension = path.extname(params.originalFileName ?? '') || '.pdf';
    const monthPrefix = params.monthKey ? `${sanitizeFileNamePart(params.monthKey)}_` : '';
    const fileName = `${params.type.toLowerCase()}_${monthPrefix}${Date.now()}${extension}`;
    const targetDir = path.join(
      this.baseDir,
      'payment-documents',
      `creator_${params.creatorUserId}`,
      `workflow_${params.workflowStateId}`,
      params.monthKey ? sanitizeFileNamePart(params.monthKey) : 'no_period'
    );

    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, fileName);
    await fs.writeFile(filePath, params.buffer);

    return {
      fileName,
      filePath
    };
  }
}
