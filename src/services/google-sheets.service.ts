import { config } from '../config';
import { logger } from '../lib/logger';
import { chunkArray } from '../utils/batch';
import { GoogleSheetsClient } from './google-sheets-client';

export type SheetCellValue = string | number | boolean | null;

export interface SheetDefinition {
  sheetName: string;
  headers: string[];
  hiddenColumnIndexes?: number[];
  columnWidths?: Record<number, number>;
  moneyColumnIndexes?: number[];
  integerColumnIndexes?: number[];
  wrapColumnIndexes?: number[];
}

export interface SheetRow {
  key: string;
  values: SheetCellValue[];
}

export interface SheetUpsertResult {
  sheetName: string;
  inserted: number;
  updated: number;
  totalRows: number;
}

export interface SpreadsheetConnectionInfo {
  spreadsheetId: string;
  title: string;
  sheets: string[];
}

type ExistingRowReference = {
  rowNumber: number;
  key: string;
};

type SheetProperties = {
  sheetId?: number | null;
  title?: string | null;
};

const columnNumberToLetters = (value: number): string => {
  let current = value;
  let letters = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }

  return letters;
};

const quoteSheetName = (sheetName: string) => `'${sheetName.replace(/'/g, "''")}'`;

const buildSheetRange = (sheetName: string, range: string) => `${quoteSheetName(sheetName)}!${range}`;

const buildColumnWidthRequests = (sheetId: number, definition: SheetDefinition) =>
  Object.entries(definition.columnWidths ?? {}).map(([index, pixelSize]) => {
    const startIndex = Number(index);

    return {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex,
          endIndex: startIndex + 1
        },
        properties: {
          pixelSize
        },
        fields: 'pixelSize'
      }
    };
  });

const buildHiddenColumnRequests = (sheetId: number, definition: SheetDefinition) =>
  (definition.hiddenColumnIndexes ?? []).map((startIndex) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex,
        endIndex: startIndex + 1
      },
      properties: {
        hiddenByUser: true
      },
      fields: 'hiddenByUser'
    }
  }));

const buildNumberFormatRequests = (
  sheetId: number,
  indexes: number[] | undefined,
  numberFormat: { type: string; pattern: string }
) =>
  (indexes ?? []).map((startIndex) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: startIndex,
        endColumnIndex: startIndex + 1
      },
      cell: {
        userEnteredFormat: {
          numberFormat
        }
      },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));

const buildWrapRequests = (sheetId: number, definition: SheetDefinition) =>
  (definition.wrapColumnIndexes ?? []).map((startIndex) => ({
    repeatCell: {
      range: {
        sheetId,
        startColumnIndex: startIndex,
        endColumnIndex: startIndex + 1
      },
      cell: {
        userEnteredFormat: {
          wrapStrategy: 'WRAP'
        }
      },
      fields: 'userEnteredFormat.wrapStrategy'
    }
  }));

export class GoogleSheetsService {
  constructor(private readonly client: GoogleSheetsClient) {}

  isEnabled() {
    return this.client.isEnabled();
  }

  async testConnection(): Promise<SpreadsheetConnectionInfo> {
    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const response = await api.spreadsheets.get({
      spreadsheetId
    });

    return {
      spreadsheetId,
      title: response.data.properties?.title ?? spreadsheetId,
      sheets:
        response.data.sheets
          ?.map((sheet) => sheet.properties?.title)
          .filter((title): title is string => Boolean(title)) ?? []
    };
  }

  async upsertRows(definition: SheetDefinition, rows: SheetRow[]): Promise<SheetUpsertResult> {
    await this.ensureSheet(definition);

    const normalizedRows = this.normalizeRows(definition, rows);

    if (normalizedRows.length === 0) {
      return {
        sheetName: definition.sheetName,
        inserted: 0,
        updated: 0,
        totalRows: 0
      };
    }

    const existingRows = await this.getExistingKeyMap(definition.sheetName);
    const rowsToUpdate: Array<SheetRow & { rowNumber: number }> = [];
    const rowsToAppend: SheetRow[] = [];

    for (const row of normalizedRows) {
      const existing = existingRows.get(row.key);

      if (existing) {
        rowsToUpdate.push({
          ...row,
          rowNumber: existing.rowNumber
        });
      } else {
        rowsToAppend.push(row);
      }
    }

    await this.batchUpdateRows(definition, rowsToUpdate);
    await this.appendRows(definition, rowsToAppend);

    return {
      sheetName: definition.sheetName,
      inserted: rowsToAppend.length,
      updated: rowsToUpdate.length,
      totalRows: normalizedRows.length
    };
  }

  async rebuildSheet(definition: SheetDefinition, rows: SheetRow[]): Promise<SheetUpsertResult> {
    await this.ensureSheet(definition);

    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const normalizedRows = this.normalizeRows(definition, rows);
    const lastColumn = columnNumberToLetters(definition.headers.length);

    await api.spreadsheets.values.clear({
      spreadsheetId,
      range: buildSheetRange(definition.sheetName, `A:${lastColumn}`)
    });

    await api.spreadsheets.values.update({
      spreadsheetId,
      range: buildSheetRange(definition.sheetName, `A1:${lastColumn}1`),
      valueInputOption: 'RAW',
      requestBody: {
        values: [definition.headers]
      }
    });

    let currentRow = 2;

    for (const chunk of chunkArray(normalizedRows, config.googleSheets.batchSize)) {
      const range = buildSheetRange(
        definition.sheetName,
        `A${currentRow}:${lastColumn}${currentRow + chunk.length - 1}`
      );
      await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: chunk.map((row) => row.values)
        }
      });
      currentRow += chunk.length;
    }

    return {
      sheetName: definition.sheetName,
      inserted: normalizedRows.length,
      updated: 0,
      totalRows: normalizedRows.length
    };
  }

  private normalizeRows(definition: SheetDefinition, rows: SheetRow[]) {
    const rowsByKey = new Map<string, SheetRow>();

    for (const row of rows) {
      const values = [...row.values];

      if (values.length !== definition.headers.length) {
        throw new Error(
          `Для листа "${definition.sheetName}" ожидалось ${definition.headers.length} колонок, получено ${values.length}`
        );
      }

      values[0] = row.key;
      rowsByKey.set(row.key, {
        key: row.key,
        values
      });
    }

    return Array.from(rowsByKey.values());
  }

  async ensureSheet(definition: SheetDefinition) {
    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const spreadsheet = await api.spreadsheets.get({
      spreadsheetId
    });
    let sheet = spreadsheet.data.sheets?.find(
      (sheet) => sheet.properties?.title === definition.sheetName
    );

    if (!sheet) {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: definition.sheetName
                }
              }
            }
          ]
        }
      });

      const updatedSpreadsheet = await api.spreadsheets.get({
        spreadsheetId
      });
      sheet = updatedSpreadsheet.data.sheets?.find(
        (item) => item.properties?.title === definition.sheetName
      );
    }

    const sheetId = this.resolveSheetId(definition.sheetName, sheet?.properties);
    await this.ensureHeader(definition);
    await this.applyPresentation(definition, sheetId);
  }

  private async ensureHeader(definition: SheetDefinition) {
    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const lastColumn = columnNumberToLetters(definition.headers.length);
    const currentHeader = await api.spreadsheets.values.get({
      spreadsheetId,
      range: buildSheetRange(definition.sheetName, `A1:${lastColumn}1`)
    });

    const existingHeader = currentHeader.data.values?.[0] ?? [];
    const headersDiffer =
      existingHeader.length !== definition.headers.length ||
      definition.headers.some((header, index) => existingHeader[index] !== header);

    if (headersDiffer) {
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: buildSheetRange(definition.sheetName, `A1:${lastColumn}1`),
        valueInputOption: 'RAW',
        requestBody: {
          values: [definition.headers]
        }
      });
    }
  }

  private async applyPresentation(definition: SheetDefinition, sheetId: number) {
    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const columnCount = definition.headers.length;
    const requests = [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: 1
            }
          },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: columnCount
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: {
                red: 0.12,
                green: 0.2,
                blue: 0.33
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
              textFormat: {
                bold: true,
                foregroundColor: {
                  red: 1,
                  green: 1,
                  blue: 1
                }
              }
            }
          },
          fields:
            'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 1
          },
          properties: {
            pixelSize: 42
          },
          fields: 'pixelSize'
        }
      },
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: columnCount
            }
          }
        }
      },
      ...buildHiddenColumnRequests(sheetId, definition),
      ...buildColumnWidthRequests(sheetId, definition),
      ...buildNumberFormatRequests(sheetId, definition.integerColumnIndexes, {
        type: 'NUMBER',
        pattern: '#,##0'
      }),
      ...buildNumberFormatRequests(sheetId, definition.moneyColumnIndexes, {
        type: 'CURRENCY',
        pattern: '#,##0 ₽'
      }),
      ...buildWrapRequests(sheetId, definition)
    ];

    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests
      }
    });
  }

  private resolveSheetId(sheetName: string, properties?: SheetProperties | null) {
    const sheetId = properties?.sheetId;

    if (typeof sheetId !== 'number') {
      throw new Error(`Не удалось получить sheetId для листа "${sheetName}"`);
    }

    return sheetId;
  }

  private async getExistingKeyMap(sheetName: string) {
    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const response = await api.spreadsheets.values.get({
      spreadsheetId,
      range: buildSheetRange(sheetName, 'A2:A')
    });

    const map = new Map<string, ExistingRowReference>();
    const values = response.data.values ?? [];

    values.forEach((row, index) => {
      const key = String(row[0] ?? '').trim();

      if (!key) {
        return;
      }

      if (map.has(key)) {
        logger.warn({ sheetName, key }, 'Duplicate key found in Google Sheet; using the last row for updates');
      }

      map.set(key, {
        key,
        rowNumber: index + 2
      });
    });

    return map;
  }

  private async batchUpdateRows(
    definition: SheetDefinition,
    rows: Array<SheetRow & { rowNumber: number }>
  ) {
    if (rows.length === 0) {
      return;
    }

    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const lastColumn = columnNumberToLetters(definition.headers.length);

    for (const chunk of chunkArray(rows, config.googleSheets.batchSize)) {
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: chunk.map((row) => ({
            range: buildSheetRange(definition.sheetName, `A${row.rowNumber}:${lastColumn}${row.rowNumber}`),
            values: [row.values]
          }))
        }
      });
    }
  }

  private async appendRows(definition: SheetDefinition, rows: SheetRow[]) {
    if (rows.length === 0) {
      return;
    }

    const api = await this.client.getSheetsApi();
    const spreadsheetId = this.client.getSpreadsheetId();

    for (const chunk of chunkArray(rows, config.googleSheets.batchSize)) {
      await api.spreadsheets.values.append({
        spreadsheetId,
        range: buildSheetRange(definition.sheetName, 'A1'),
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: chunk.map((row) => row.values)
        }
      });
    }
  }
}
