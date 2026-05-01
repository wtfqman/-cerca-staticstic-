import { container } from '../container';
import { logger } from '../lib/logger';

export const runGoogleSheetsNightlyJob = async () => {
  if (!container.services.googleSheetsSyncService.isEnabled()) {
    return;
  }

  logger.info('Starting nightly Google Sheets sync');
  const result = await container.services.googleSheetsSyncService.syncAll();
  logger.info({ result }, 'Nightly Google Sheets sync completed');
};
