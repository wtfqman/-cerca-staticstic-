import { google, type sheets_v4 } from 'googleapis';

import { config } from '../config';

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class GoogleSheetsClient {
  private sheetsApi?: sheets_v4.Sheets;

  isEnabled() {
    return config.googleSheets.enabled;
  }

  getSpreadsheetId() {
    if (!config.googleSheets.spreadsheetId) {
      throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not configured');
    }

    return config.googleSheets.spreadsheetId;
  }

  async getSheetsApi() {
    if (this.sheetsApi) {
      return this.sheetsApi;
    }

    const auth = new google.auth.GoogleAuth({
      scopes: [GOOGLE_SHEETS_SCOPE],
      ...this.resolveAuthOptions()
    });

    this.sheetsApi = google.sheets({
      version: 'v4',
      auth
    });

    return this.sheetsApi;
  }

  private resolveAuthOptions(): { credentials?: ServiceAccountCredentials; keyFile?: string } {
    switch (config.googleSheets.authMode) {
      case 'application_credentials':
        return {
          keyFile: config.googleSheets.applicationCredentialsPath!
        };
      case 'service_account_env':
        return {
          credentials: {
            client_email: config.googleSheets.serviceAccountEmail!,
            private_key: config.googleSheets.privateKey!
          }
        };
      default:
        throw new Error(
          'Google Sheets integration is disabled or credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.'
        );
    }
  }
}
