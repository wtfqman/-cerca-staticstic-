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
  appliedRate: number;
  viewSteps: number;
  variablePart: number;
  totalPayment: number;
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
const SOCIALS_WEEK_METRICS = ['Неделя', 'Охват', 'Лайки', 'Комментарии', 'Репосты', 'Сохранения'];

const buildSocialsHeaders = () => [
  'Ключ синхронизации',
  'ID креатора',
  'Соцсеть',
  'Креатор',
  'Тимлид',
  'Месяц',
  'Итого охват',
  'Итого лайки',
  'Итого комментарии',
  'Итого репосты',
  'Итого сохранения',
  'Видео за месяц',
  ...Array.from({ length: SOCIALS_WEEK_SLOT_COUNT }).flatMap((_, weekIndex) =>
    SOCIALS_WEEK_METRICS.map((metric) => `${metric} ${weekIndex + 1}`)
  ),
  'Обновлено'
];

const buildSocialsIntegerColumnIndexes = () => {
  const indexes: number[] = [6, 7, 8, 9, 10, 11];

  for (let weekIndex = 0; weekIndex < SOCIALS_WEEK_SLOT_COUNT; weekIndex += 1) {
    const startIndex = 12 + weekIndex * SOCIALS_WEEK_METRICS.length;
    indexes.push(startIndex + 1, startIndex + 2, startIndex + 3, startIndex + 4, startIndex + 5);
  }

  return indexes;
};

const buildSocialsColumnWidths = () => {
  const widths: Record<number, number> = {
    2: 105,
    3: 210,
    4: 170,
    5: 90,
    6: 120,
    7: 105,
    8: 135,
    9: 115,
    10: 130,
    11: 120
  };

  for (let weekIndex = 0; weekIndex < SOCIALS_WEEK_SLOT_COUNT; weekIndex += 1) {
    const startIndex = 12 + weekIndex * SOCIALS_WEEK_METRICS.length;
    widths[startIndex] = 155;
    widths[startIndex + 1] = 105;
    widths[startIndex + 2] = 80;
    widths[startIndex + 3] = 110;
    widths[startIndex + 4] = 90;
    widths[startIndex + 5] = 110;
  }

  widths[48] = 135;
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
      wrapColumnIndexes: [3, 4],
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
        'Окладная часть',
        'Просмотры фактические',
        'Просмотры округленные',
        'Ставка за шаг',
        'Шаг просмотров',
        'Переменная часть',
        'Итого к выплате',
        'Расчет обновлен'
      ],
      hiddenColumnIndexes: [0, 1],
      integerColumnIndexes: [5, 7, 8, 10],
      moneyColumnIndexes: [6, 9, 11, 12],
      wrapColumnIndexes: [2, 3],
      columnWidths: {
        2: 210,
        3: 180,
        4: 90,
        5: 120,
        6: 130,
        7: 145,
        8: 150,
        9: 125,
        10: 120,
        11: 140,
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
        ? [week.period, week.views, week.likes, week.comments, week.reposts, week.saves]
        : ['', 0, 0, 0, 0, 0];
    });

    return {
      key: input.syncKey,
      values: [
        input.syncKey,
        input.creatorUserId,
        labelOrValue(platformLabelMap, input.platform),
        input.creatorName,
        input.teamLeadName,
        input.monthKey,
        input.totalViews,
        input.totalLikes,
        input.totalComments,
        input.totalReposts,
        input.totalSaves,
        input.monthlyVideoCount ?? '',
        ...weekValues,
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
        input.fixedSalaryPart,
        input.rawViews,
        input.roundedViews,
        input.appliedRate,
        input.viewSteps,
        input.variablePart,
        input.totalPayment,
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
