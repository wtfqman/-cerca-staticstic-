import { config } from '../config';
import type { SheetDefinition, SheetRow } from './google-sheets.service';

export interface StatsSheetRowInput {
  weeklyStatItemId: string;
  weeklyReportId: string;
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  weekStart: string;
  weekEnd: string;
  platform: string;
  videoCount: number;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
  reportStatus: string;
  reviewStatus: string;
  reviewedByTeamLeadName: string;
  reviewedAt: string;
  submittedAt: string;
  updatedAt: string;
}

export interface SocialsSheetWeekInput {
  period: string;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
}

export interface SocialsSheetRowInput {
  syncKey: string;
  creatorUserId: string;
  platform: string;
  socialLink: string;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  weeks: SocialsSheetWeekInput[];
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalReposts: number;
  totalSaves: number;
  monthlyVideoCount: number | null;
  updatedAt: string;
}

export interface PaymentsSheetRowInput {
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  actualVideoCount: number;
  fixedSalaryPart: number;
  rawViews: number;
  roundedViews: number;
  variablePart: number;
  baseTotalPayment: number;
  invoiceSurcharge: number;
  invoiceTotalPayment: number;
  calculationUpdatedAt: string;
}

export interface DocumentsSheetRowInput {
  documentId: string;
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  documentType: string;
  legalType: string;
  scopeKey: string;
  monthKey: string;
  status: string;
  fileName: string;
  generatedAt: string;
  sentAt: string;
  signedUploadedAt: string;
  forwardedAt: string;
  updatedAt: string;
}

const platformLabelMap: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  VK: 'VK',
  YOUTUBE: 'YouTube'
};

const weeklyReportStatusLabelMap: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлен',
  CONFIRMED: 'Подтвержден'
};

const legalTypeLabelMap: Record<string, string> = {
  SELF_EMPLOYED: 'Самозанятый',
  IP: 'ИП'
};

const documentTypeLabelMap: Record<string, string> = {
  CONTRACT: 'Договор',
  NDA: 'NDA',
  ACT: 'Акт',
  ASSIGNMENT: 'Задание',
  RIGHTS_TRANSFER: 'Передача прав'
};

const documentStatusLabelMap: Record<string, string> = {
  GENERATED: 'Сформирован',
  SENT_TO_CREATOR: 'Отправлен креатору',
  VIEWED_BY_CREATOR: 'Открыт креатором',
  SIGNED_UPLOADED: 'Подписанный PDF получен',
  FORWARDED_TO_CHAT: 'Переслан в чат',
  FAILED: 'Ошибка'
};

const labelOrValue = (map: Record<string, string>, value: string) => map[value] ?? value;

const SOCIALS_WEEK_SLOT_COUNT = 6;
const SOCIALS_WEEK_METRICS = ['Неделя', 'Охват', 'Лайки', 'Комментарии', 'Сохранения', 'Репосты'];
const SOCIALS_BASE_COLUMN_COUNT = 7;

const buildSocialsHeaders = () => [
  'Ключ синхронизации',
  'ID креатора',
  'Соцсеть',
  'Ссылка',
  'Креатор',
  'Тимлид',
  'Месяц',
  ...Array.from({ length: SOCIALS_WEEK_SLOT_COUNT }).flatMap((_, weekIndex) =>
    SOCIALS_WEEK_METRICS.map((metric) => `${metric} ${weekIndex + 1}`)
  ),
  'Итого охват',
  'Итого лайки',
  'Итого комментарии',
  'Итого сохранения',
  'Итого репосты',
  'Видео за месяц',
  'Обновлено'
];

const buildSocialsIntegerColumnIndexes = () => {
  const indexes: number[] = [];

  for (let weekIndex = 0; weekIndex < SOCIALS_WEEK_SLOT_COUNT; weekIndex += 1) {
    const startIndex = SOCIALS_BASE_COLUMN_COUNT + weekIndex * SOCIALS_WEEK_METRICS.length;
    indexes.push(startIndex + 1, startIndex + 2, startIndex + 3, startIndex + 4, startIndex + 5);
  }

  const totalsStartIndex = SOCIALS_BASE_COLUMN_COUNT + SOCIALS_WEEK_SLOT_COUNT * SOCIALS_WEEK_METRICS.length;
  indexes.push(
    totalsStartIndex,
    totalsStartIndex + 1,
    totalsStartIndex + 2,
    totalsStartIndex + 3,
    totalsStartIndex + 4,
    totalsStartIndex + 5
  );

  return indexes;
};

const buildSocialsColumnWidths = () => {
  const widths: Record<number, number> = {
    2: 105,
    3: 210,
    4: 210,
    5: 170,
    6: 90
  };

  for (let weekIndex = 0; weekIndex < SOCIALS_WEEK_SLOT_COUNT; weekIndex += 1) {
    const startIndex = SOCIALS_BASE_COLUMN_COUNT + weekIndex * SOCIALS_WEEK_METRICS.length;
    widths[startIndex] = 155;
    widths[startIndex + 1] = 105;
    widths[startIndex + 2] = 80;
    widths[startIndex + 3] = 110;
    widths[startIndex + 4] = 110;
    widths[startIndex + 5] = 90;
  }

  const totalsStartIndex = SOCIALS_BASE_COLUMN_COUNT + SOCIALS_WEEK_SLOT_COUNT * SOCIALS_WEEK_METRICS.length;
  widths[totalsStartIndex] = 120;
  widths[totalsStartIndex + 1] = 105;
  widths[totalsStartIndex + 2] = 135;
  widths[totalsStartIndex + 3] = 130;
  widths[totalsStartIndex + 4] = 115;
  widths[totalsStartIndex + 5] = 120;
  widths[totalsStartIndex + 6] = 135;

  return widths;
};

export class SpreadsheetFormatterService {
  getStatsSheetDefinition(): SheetDefinition {
    return {
      sheetName: config.googleSheets.sheetNames.stats,
      headers: [
        'Ключ синхронизации',
        'ID строки статистики',
        'ID недельного отчета',
        'ID креатора',
        'Соцсеть',
        'Креатор',
        'Тимлид',
        'Месяц',
        'Неделя с',
        'Неделя по',
        'Видео за неделю',
        'Просмотры',
        'Лайки',
        'Комментарии',
        'Репосты',
        'Сохранения',
        'Статус отчета',
        'Проверка тимлидом',
        'Проверил',
        'Дата проверки',
        'Отправлено',
        'Обновлено'
      ],
      hiddenColumnIndexes: [0, 1, 2, 3],
      integerColumnIndexes: [10, 11, 12, 13, 14, 15],
      wrapColumnIndexes: [5, 6, 16, 17, 18],
      columnWidths: {
        4: 105,
        5: 210,
        6: 170,
        7: 90,
        8: 105,
        9: 105,
        10: 80,
        11: 110,
        12: 90,
        13: 110,
        14: 95,
        15: 115,
        16: 130,
        17: 150,
        18: 170,
        19: 130,
        20: 135,
        21: 135
      }
    };
  }

  getSocialsSheetDefinition(): SheetDefinition {
    return {
      sheetName: config.googleSheets.sheetNames.socials,
      headers: buildSocialsHeaders(),
      hiddenColumnIndexes: [0, 1],
      integerColumnIndexes: buildSocialsIntegerColumnIndexes(),
      wrapColumnIndexes: [3, 4, 5],
      columnWidths: buildSocialsColumnWidths()
    };
  }

  getPaymentsSheetDefinition(): SheetDefinition {
    return {
      sheetName: config.googleSheets.sheetNames.payments,
      headers: [
        'Ключ синхронизации',
        'ID креатора',
        'Креатор',
        'Тимлид',
        'Месяц',
        'Видео за месяц',
        'Просмотры фактические',
        'Просмотры округленные',
        'Оклад',
        'Переменная часть',
        'Сумма по акту',
        '+ к счету',
        'Сумма счета',
        'Расчет обновлен'
      ],
      hiddenColumnIndexes: [0, 1],
      integerColumnIndexes: [5, 6, 7],
      moneyColumnIndexes: [8, 9, 10, 11, 12],
      wrapColumnIndexes: [2, 3],
      columnWidths: {
        2: 210,
        3: 180,
        4: 90,
        5: 120,
        6: 145,
        7: 150,
        8: 130,
        9: 140,
        10: 140,
        11: 105,
        12: 140,
        13: 135
      }
    };
  }

  getDocumentsSheetDefinition(): SheetDefinition {
    return {
      sheetName: config.googleSheets.sheetNames.documents,
      headers: [
        'Ключ синхронизации',
        'ID документа',
        'ID креатора',
        'Креатор',
        'Тимлид',
        'Документ',
        'Тип',
        'Период / ключ',
        'Месяц',
        'Статус',
        'Файл',
        'Сформирован',
        'Отправлен',
        'Подписан',
        'Переслан',
        'Обновлен'
      ],
      hiddenColumnIndexes: [0, 1, 2],
      wrapColumnIndexes: [3, 4, 5, 9, 10],
      columnWidths: {
        3: 210,
        4: 180,
        5: 155,
        6: 120,
        7: 125,
        8: 90,
        9: 175,
        10: 220,
        11: 135,
        12: 135,
        13: 135,
        14: 135,
        15: 135
      }
    };
  }

  buildStatsRow(input: StatsSheetRowInput): SheetRow {
    return {
      key: input.weeklyStatItemId,
      values: [
        input.weeklyStatItemId,
        input.weeklyStatItemId,
        input.weeklyReportId,
        input.creatorUserId,
        labelOrValue(platformLabelMap, input.platform),
        input.creatorName,
        input.teamLeadName,
        input.monthKey,
        input.weekStart,
        input.weekEnd,
        input.videoCount,
        input.views,
        input.likes,
        input.comments,
        input.reposts,
        input.saves,
        labelOrValue(weeklyReportStatusLabelMap, input.reportStatus),
        input.reviewStatus,
        input.reviewedByTeamLeadName,
        input.reviewedAt,
        input.submittedAt,
        input.updatedAt
      ]
    };
  }

  buildSocialsRow(input: SocialsSheetRowInput): SheetRow {
    const weekValues = Array.from({ length: SOCIALS_WEEK_SLOT_COUNT }).flatMap((_, index) => {
      const week = input.weeks[index];

      return week
        ? [week.period, week.views, week.likes, week.comments, week.saves, week.reposts]
        : ['', 0, 0, 0, 0, 0];
    });

    return {
      key: input.syncKey,
      values: [
        input.syncKey,
        input.creatorUserId,
        labelOrValue(platformLabelMap, input.platform),
        input.socialLink,
        input.creatorName,
        input.teamLeadName,
        input.monthKey,
        ...weekValues,
        input.totalViews,
        input.totalLikes,
        input.totalComments,
        input.totalSaves,
        input.totalReposts,
        input.monthlyVideoCount ?? '',
        input.updatedAt
      ]
    };
  }

  buildPaymentsRow(input: PaymentsSheetRowInput): SheetRow {
    const syncKey = `${input.creatorUserId}:${input.monthKey}`;

    return {
      key: syncKey,
      values: [
        syncKey,
        input.creatorUserId,
        input.creatorName,
        input.teamLeadName,
        input.monthKey,
        input.actualVideoCount,
        input.rawViews,
        input.roundedViews,
        input.fixedSalaryPart,
        input.variablePart,
        input.baseTotalPayment,
        input.invoiceSurcharge,
        input.invoiceTotalPayment,
        input.calculationUpdatedAt
      ]
    };
  }

  buildDocumentsRow(input: DocumentsSheetRowInput): SheetRow {
    const syncKey = `${input.creatorUserId}:${input.documentType}:${input.scopeKey}`;

    return {
      key: syncKey,
      values: [
        syncKey,
        input.documentId,
        input.creatorUserId,
        input.creatorName,
        input.teamLeadName,
        labelOrValue(documentTypeLabelMap, input.documentType),
        labelOrValue(legalTypeLabelMap, input.legalType),
        input.scopeKey,
        input.monthKey,
        labelOrValue(documentStatusLabelMap, input.status),
        input.fileName,
        input.generatedAt,
        input.sentAt,
        input.signedUploadedAt,
        input.forwardedAt,
        input.updatedAt
      ]
    };
  }
}
