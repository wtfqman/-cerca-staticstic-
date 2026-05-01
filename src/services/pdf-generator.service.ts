import fs from 'node:fs';

import { chromium, type Browser } from 'playwright';

import { logger } from '../lib/logger';
import { config } from '../config';

const PLAYWRIGHT_INSTALL_HINT = 'Run "npx playwright install chromium" on the server where the bot is deployed.';
const PDF_GENERATION_UNAVAILABLE_MESSAGE =
  'Сейчас генерация документов временно недоступна. Попробуй позже или сообщи администратору.';

export class PdfGenerationUnavailableError extends Error {
  constructor() {
    super(PDF_GENERATION_UNAVAILABLE_MESSAGE);
    this.name = 'PdfGenerationUnavailableError';
  }
}

export class PdfGeneratorService {
  async renderPdf(html: string): Promise<Buffer> {
    const executablePath = this.resolveExecutablePath();
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({
        headless: config.pdf.headless,
        executablePath
      });

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'networkidle',
        timeout: config.pdf.browserTimeoutMs
      });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        }
      });

      return Buffer.from(pdf);
    } catch (error) {
      if (error instanceof PdfGenerationUnavailableError) {
        throw error;
      }

      logger.error(
        {
          error,
          executablePath,
          installHint: PLAYWRIGHT_INSTALL_HINT
        },
        'PDF generation failed'
      );

      throw new PdfGenerationUnavailableError();
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          logger.warn({ error }, 'Failed to close Playwright browser after PDF generation');
        }
      }
    }
  }

  private resolveExecutablePath() {
    const executablePath = config.pdf.executablePath ?? chromium.executablePath();

    if (!fs.existsSync(executablePath)) {
      logger.error(
        {
          executablePath,
          installHint: PLAYWRIGHT_INSTALL_HINT
        },
        'Playwright Chromium executable is missing'
      );

      throw new PdfGenerationUnavailableError();
    }

    return executablePath;
  }
}
