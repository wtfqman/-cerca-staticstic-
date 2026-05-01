import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import mammoth from 'mammoth';

import { PdfGeneratorService } from './pdf-generator.service';
import { logger } from '../lib/logger';
import { config } from '../config';

const execFileAsync = promisify(execFile);

const LIBREOFFICE_CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  'soffice',
  'libreoffice'
];

const PDF_EXPORT_FILTER = 'pdf:writer_pdf_Export';

export class DocxPdfService {
  constructor(private readonly pdfGeneratorService: PdfGeneratorService) {}

  async renderPdfFromDocx(docxBuffer: Buffer): Promise<Buffer> {
    const libreOfficePdf = await this.tryRenderWithLibreOffice(docxBuffer);

    if (libreOfficePdf) {
      return libreOfficePdf;
    }

    const converted = await mammoth.convertToHtml(
      { buffer: docxBuffer },
      {
        includeDefaultStyleMap: true
      }
    );

    if (converted.messages.length > 0) {
      logger.warn({ messages: converted.messages }, 'DOCX to HTML conversion reported warnings');
    }

    return this.pdfGeneratorService.renderPdf(this.wrapHtml(converted.value));
  }

  private async tryRenderWithLibreOffice(docxBuffer: Buffer): Promise<Buffer | null> {
    for (const executablePath of this.resolveLibreOfficeCandidates()) {
      const rendered = await this.tryRenderWithLibreOfficeExecutable(docxBuffer, executablePath);

      if (rendered) {
        return rendered;
      }
    }

    if (!config.pdf.docxHtmlFallbackEnabled || config.app.env === 'production') {
      throw new Error(
        'LibreOffice executable was not found. DOCX layout-preserving PDF generation is unavailable. ' +
          'Install LibreOffice or configure LIBREOFFICE_EXECUTABLE_PATH.'
      );
    }

    logger.warn(
      'LibreOffice executable was not found. Falling back to DOCX HTML conversion before PDF rendering. ' +
        'This fallback is for testing and may not preserve DOCX layout exactly.'
    );

    return null;
  }

  private resolveLibreOfficeCandidates() {
    return Array.from(
      new Set([
        config.pdf.libreOfficeExecutablePath,
        ...LIBREOFFICE_CANDIDATES
      ].filter(Boolean) as string[])
    );
  }

  private async tryRenderWithLibreOfficeExecutable(
    docxBuffer: Buffer,
    executablePath: string
  ): Promise<Buffer | null> {
    if (path.isAbsolute(executablePath) && !fsSync.existsSync(executablePath)) {
      return null;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerca-docx-'));
    const profileDir = path.join(tmpDir, 'lo-profile');
    const inputPath = path.join(tmpDir, 'document.docx');
    const outputPath = path.join(tmpDir, 'document.pdf');

    try {
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(inputPath, docxBuffer);
      await execFileAsync(
        executablePath,
        [
          '--headless',
          '--nologo',
          '--nodefault',
          '--nofirststartwizard',
          '--nolockcheck',
          '--norestore',
          `-env:UserInstallation=file:///${profileDir.replace(/\\/g, '/')}`,
          '--convert-to',
          PDF_EXPORT_FILTER,
          '--outdir',
          tmpDir,
          inputPath
        ],
        { timeout: 60_000, windowsHide: true }
      );

      if (!fsSync.existsSync(outputPath)) {
        throw new Error(`LibreOffice did not create expected PDF: ${outputPath}`);
      }

      return await fs.readFile(outputPath);
    } catch (error) {
      logger.debug({ error, executablePath }, 'LibreOffice DOCX to PDF conversion attempt failed');
      return null;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private wrapHtml(body: string) {
    return [
      '<!doctype html>',
      '<html lang="ru">',
      '<head>',
      '<meta charset="utf-8" />',
      '<style>',
      'body { font-family: Arial, sans-serif; font-size: 12px; line-height: 1.35; color: #111; }',
      'table { width: 100%; border-collapse: collapse; }',
      'td, th { vertical-align: top; }',
      'p { margin: 0 0 8px; }',
      'h1, h2, h3 { margin: 14px 0 10px; }',
      '</style>',
      '</head>',
      '<body>',
      body,
      '</body>',
      '</html>'
    ].join('');
  }
}
