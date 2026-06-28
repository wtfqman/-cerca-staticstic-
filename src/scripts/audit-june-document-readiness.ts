import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import {
  DocumentStatus,
  DocumentType,
  DocumentWorkflowQueue,
  LegalType,
  PaymentDocumentStatus,
  PaymentDocumentType,
  PrismaClient,
  UserRole,
  WeeklyReportStatus
} from '@prisma/client';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);
const SUBMITTED_WEEKLY_STATUSES = new Set<WeeklyReportStatus>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);
const SECOND_QUEUE_DOCUMENT_TYPES = [
  DocumentType.ASSIGNMENT,
  DocumentType.ACT,
  DocumentType.ACT_1000
] as const;

const activeCreatorWhere = {
  isActive: true,
  OR: [
    { role: UserRole.CREATOR },
    { role: UserRole.ADMIN, creatorProfile: { isNot: null } },
    { role: UserRole.TEAMLEAD, creatorProfile: { isNot: null } },
    { role: null, creatorProfile: { isNot: null } }
  ]
};

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const monthKey = getArgValue('--month') ?? '2026-06';
const jsonOutput = process.argv.includes('--json');

const toDateOnly = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
const toDateKey = (value?: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const getMonthRange = (key: string) => {
  const start = new Date(`${key}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10)
  };
};

const getMonthWeeklyPeriods = (key: string) => {
  const range = getMonthRange(key);
  const monthStart = toDateOnly(range.dateFrom);
  const monthEnd = toDateOnly(range.dateTo);
  const cursor = new Date(monthStart);
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() - (day - 1));

  const periods: Array<{ weekStart: string; weekEnd: string; monthKey: string }> = [];

  while (cursor <= monthEnd) {
    const weekStartDate = new Date(Math.max(cursor.getTime(), monthStart.getTime()));
    const rawWeekEnd = new Date(cursor);
    rawWeekEnd.setUTCDate(rawWeekEnd.getUTCDate() + 6);
    const weekEndDate = new Date(Math.min(rawWeekEnd.getTime(), monthEnd.getTime()));

    periods.push({
      weekStart: weekStartDate.toISOString().slice(0, 10),
      weekEnd: weekEndDate.toISOString().slice(0, 10),
      monthKey: key
    });

    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return periods;
};

const csvEscape = (value: unknown) => {
  const text = String(value ?? '');

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const formatName = (user: {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  creatorProfile: { fullName: string | null } | null;
}) => {
  const telegramName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  return user.creatorProfile?.fullName || telegramName || user.username || user.telegramId;
};

const parsePayloadDateKey = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const russianDate = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (russianDate) {
    const [, day, month, year] = russianDate;
    return `${year}-${month}-${day}`;
  }

  const isoDate = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  return isoDate ? value.trim() : null;
};

const getPayloadRecord = (value: unknown) =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

const getPayloadDateKey = (payloadJson: unknown) => {
  const payload = getPayloadRecord(payloadJson);

  return parsePayloadDateKey(payload.contractDate) ??
    parsePayloadDateKey(payload.documentDate) ??
    parsePayloadDateKey(payload.generatedDate);
};

const getDocumentPayloadDate = (payloadJson: unknown) => {
  const payload = getPayloadRecord(payloadJson);

  return parsePayloadDateKey(payload.documentDate) ?? parsePayloadDateKey(payload.generatedDate);
};

const pickBestDocument = <T extends {
  status: DocumentStatus;
  generatedAt: Date;
  signedUploadedAt: Date | null;
  forwardedAt: Date | null;
}>(documents: T[]) =>
  [...documents]
    .sort((left, right) => {
      const leftSigned = SIGNED_DOCUMENT_STATUSES.has(left.status) ? 1 : 0;
      const rightSigned = SIGNED_DOCUMENT_STATUSES.has(right.status) ? 1 : 0;

      if (leftSigned !== rightSigned) {
        return rightSigned - leftSigned;
      }

      const leftTime = left.forwardedAt ?? left.signedUploadedAt ?? left.generatedAt;
      const rightTime = right.forwardedAt ?? right.signedUploadedAt ?? right.generatedAt;

      return rightTime.getTime() - leftTime.getTime();
    })[0] ?? null;

const hasText = (value?: string | null) => Boolean(value?.trim());
const hasDigits = (value: string | null | undefined, length: number) =>
  (value ?? '').replace(/\D/g, '').length === length;

const getProfileIssues = (profile: {
  legalType: LegalType | null;
  profileCompleted: boolean;
  fullName: string | null;
  contractStartDate: Date | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  passportSeries: string | null;
  passportNumber: string | null;
  passportIssuedAt: Date | null;
  passportIssuedByInstrumental: string | null;
  passportDepartmentCode: string | null;
  registrationAddress: string | null;
  ogrnip: string | null;
  taxSystem: string | null;
  bankAccount: string | null;
  bankBik: string | null;
  bankCorrAccount: string | null;
  bankName: string | null;
} | null) => {
  const issues: string[] = [];

  if (!profile) {
    return ['NO_CREATOR_PROFILE'];
  }

  if (!profile.profileCompleted) {
    issues.push('PROFILE_NOT_COMPLETED');
  }

  if (!profile.legalType) {
    return issues;
  }

  if (!hasText(profile.fullName)) issues.push('MISSING_FULL_NAME');
  if (!profile.contractStartDate) issues.push('MISSING_CONTRACT_START_DATE');
  if (!hasText(profile.phone)) issues.push('MISSING_PHONE');
  if (!hasText(profile.email)) issues.push('MISSING_EMAIL');
  if (!hasText(profile.registrationAddress)) issues.push('MISSING_ADDRESS');
  if (!hasText(profile.inn)) issues.push('MISSING_INN');
  if (!hasDigits(profile.passportSeries, 4)) issues.push('MISSING_OR_BAD_PASSPORT_SERIES');
  if (!hasDigits(profile.passportNumber, 6)) issues.push('MISSING_OR_BAD_PASSPORT_NUMBER');
  if (!profile.passportIssuedAt) issues.push('MISSING_PASSPORT_ISSUED_AT');
  if (!hasText(profile.passportIssuedByInstrumental)) issues.push('MISSING_PASSPORT_ISSUED_BY');
  if (!hasDigits(profile.passportDepartmentCode, 6)) issues.push('MISSING_OR_BAD_PASSPORT_DEPARTMENT_CODE');
  if (!hasDigits(profile.bankAccount, 20)) issues.push('MISSING_OR_BAD_BANK_ACCOUNT');
  if (!hasDigits(profile.bankBik, 9)) issues.push('MISSING_OR_BAD_BANK_BIK');
  if (!hasDigits(profile.bankCorrAccount, 20)) issues.push('MISSING_OR_BAD_BANK_CORR_ACCOUNT');
  if (!hasText(profile.bankName)) issues.push('MISSING_BANK_NAME');

  if (profile.legalType === LegalType.IP) {
    if (!hasDigits(profile.ogrnip, 15)) issues.push('MISSING_OR_BAD_OGRNIP');
    if (!hasText(profile.taxSystem)) issues.push('MISSING_TAX_SYSTEM');
  }

  return issues;
};

const main = async () => {
  const expectedPeriods = getMonthWeeklyPeriods(monthKey);
  const monthRange = getMonthRange(monthKey);
  const users = await prisma.user.findMany({
    where: activeCreatorWhere,
    include: {
      creatorProfile: true,
      documents: {
        include: {
          signatureUploads: {
            orderBy: { uploadedAt: 'desc' }
          },
          workflowLinks: true
        }
      },
      monthlyVideoCounts: {
        where: { monthKey }
      },
      weeklyStatReports: {
        where: { monthKey },
        include: {
          items: true,
          attachments: true
        }
      },
      documentWorkflowStates: {
        include: {
          campaign: true,
          documents: {
            include: {
              document: true
            }
          },
          paymentUploads: true
        }
      }
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { createdAt: 'asc' }]
  });

  const rows = users.map((user) => {
    const profileIssues = getProfileIssues(user.creatorProfile);
    const isNoContract = user.creatorProfile?.profileCompleted === true && user.creatorProfile.legalType === null;
    const expectedContractDate = toDateKey(user.creatorProfile?.contractStartDate);
    const contract = pickBestDocument(user.documents.filter((document) => document.type === DocumentType.CONTRACT));
    const nda = pickBestDocument(user.documents.filter((document) => document.type === DocumentType.NDA));
    const contractSigned = Boolean(contract && SIGNED_DOCUMENT_STATUSES.has(contract.status));
    const ndaSigned = Boolean(nda && SIGNED_DOCUMENT_STATUSES.has(nda.status));
    const contractPayloadDate = getPayloadDateKey(contract?.payloadJson);
    const ndaPayloadDate = getPayloadDateKey(nda?.payloadJson);
    const contractDateMatches = !expectedContractDate || !contractPayloadDate || contractPayloadDate === expectedContractDate;
    const ndaDateMatches = !expectedContractDate || !ndaPayloadDate || ndaPayloadDate === expectedContractDate;
    const firstQueueReady = isNoContract || (contractSigned && ndaSigned && contractDateMatches && ndaDateMatches);
    const reports = user.weeklyStatReports.filter((report) => SUBMITTED_WEEKLY_STATUSES.has(report.status));
    const submittedPeriodKeys = new Set(reports.map((report) => `${toDateKey(report.weekStart)}:${toDateKey(report.weekEnd)}`));
    const missingPeriods = expectedPeriods
      .filter((period) => !submittedPeriodKeys.has(`${period.weekStart}:${period.weekEnd}`))
      .map((period) => `${period.weekStart}:${period.weekEnd}`);
    const platformsWithReach = new Set(
      reports.flatMap((report) => report.items.filter((item) => item.views > 0).map((item) => item.platform))
    );
    const screenshotCount = reports.reduce((sum, report) => sum + report.attachments.length, 0);
    const monthlyVideoSubmitted = Boolean(user.monthlyVideoCounts[0]);
    const statisticsReady =
      monthlyVideoSubmitted &&
      missingPeriods.length === 0 &&
      platformsWithReach.size > 0 &&
      screenshotCount >= Math.max(1, platformsWithReach.size);
    const secondQueueDocuments = Object.fromEntries(
      SECOND_QUEUE_DOCUMENT_TYPES.map((type) => {
        const document = pickBestDocument(
          user.documents.filter((item) => item.type === type && item.monthKey === monthKey)
        );
        const expectedDate = type === DocumentType.ASSIGNMENT ? monthRange.dateFrom : monthRange.dateTo;
        const payloadDate = getDocumentPayloadDate(document?.payloadJson);

        return [
          type,
          {
            status: document?.status ?? 'NOT_GENERATED',
            signed: Boolean(document && SIGNED_DOCUMENT_STATUSES.has(document.status)),
            payloadDate,
            expectedDate,
            dateMatches: !payloadDate || payloadDate === expectedDate
          }
        ];
      })
    ) as Record<typeof SECOND_QUEUE_DOCUMENT_TYPES[number], {
      status: string;
      signed: boolean;
      payloadDate: string | null;
      expectedDate: string;
      dateMatches: boolean;
    }>;
    const secondQueueGenerated = SECOND_QUEUE_DOCUMENT_TYPES.every((type) =>
      secondQueueDocuments[type].status !== 'NOT_GENERATED'
    );
    const secondQueueSigned = SECOND_QUEUE_DOCUMENT_TYPES.every((type) => secondQueueDocuments[type].signed);
    const secondQueueDatesOk = SECOND_QUEUE_DOCUMENT_TYPES.every((type) => secondQueueDocuments[type].dateMatches);
    const invoiceUploaded = user.documentWorkflowStates
      .flatMap((state) => state.paymentUploads)
      .some(
        (upload) =>
          upload.type === PaymentDocumentType.INVOICE &&
          upload.monthKey === monthKey &&
          upload.status !== PaymentDocumentStatus.REJECTED
      );
    const blockers = [
      ...profileIssues,
      !isNoContract && !contractSigned ? 'MISSING_SIGNED_CONTRACT' : null,
      !isNoContract && !ndaSigned ? 'MISSING_SIGNED_NDA' : null,
      !isNoContract && !contractDateMatches ? `CONTRACT_DATE_MISMATCH:${contractPayloadDate}->${expectedContractDate}` : null,
      !isNoContract && !ndaDateMatches ? `NDA_DATE_MISMATCH:${ndaPayloadDate}->${expectedContractDate}` : null,
      !statisticsReady ? 'STATISTICS_NOT_READY' : null,
      secondQueueGenerated && !secondQueueDatesOk ? 'SECOND_QUEUE_DATE_MISMATCH' : null
    ].filter((value): value is string => Boolean(value));

    return {
      creatorUserId: user.id,
      telegramId: user.telegramId,
      username: user.username ? `@${user.username}` : '',
      name: formatName(user),
      legalType: user.creatorProfile?.legalType ?? null,
      isNoContract,
      contractStartDate: expectedContractDate,
      profileIssues: profileIssues.join('; '),
      contractStatus: contract?.status ?? 'NOT_GENERATED',
      ndaStatus: nda?.status ?? 'NOT_GENERATED',
      contractPayloadDate,
      ndaPayloadDate,
      firstQueueReady,
      monthlyVideoSubmitted,
      submittedPeriods: submittedPeriodKeys.size,
      expectedPeriods: expectedPeriods.length,
      missingPeriods: missingPeriods.join(' | '),
      reachPlatforms: [...platformsWithReach].sort().join(' | '),
      screenshotCount,
      statisticsReady,
      secondQueueGenerated,
      secondQueueSigned,
      secondQueueDatesOk,
      assignmentStatus: secondQueueDocuments.ASSIGNMENT.status,
      assignmentPayloadDate: secondQueueDocuments.ASSIGNMENT.payloadDate,
      actStatus: secondQueueDocuments.ACT.status,
      actPayloadDate: secondQueueDocuments.ACT.payloadDate,
      act1000Status: secondQueueDocuments.ACT_1000.status,
      act1000PayloadDate: secondQueueDocuments.ACT_1000.payloadDate,
      invoiceUploaded,
      readyToGenerateSecondQueue: !isNoContract && firstQueueReady && blockers.every((item) => item === 'STATISTICS_NOT_READY'),
      readyForJuneInvoice: isNoContract
        ? statisticsReady
        : statisticsReady && firstQueueReady && secondQueueSigned && secondQueueDatesOk,
      blockers: blockers.join('; ')
    };
  });

  const summary = {
    monthKey,
    configuredWorkflowMonth: process.env.DOCUMENT_WORKFLOW_MONTH_KEY || '(not set)',
    expectedPeriods: expectedPeriods.map((period) => `${period.weekStart}:${period.weekEnd}`).join(', '),
    activeCreators: rows.length,
    firstQueueReady: rows.filter((row) => row.firstQueueReady).length,
    statisticsReady: rows.filter((row) => row.statisticsReady).length,
    readyToGenerateSecondQueue: rows.filter((row) => row.readyToGenerateSecondQueue).length,
    secondQueueGenerated: rows.filter((row) => row.secondQueueGenerated).length,
    secondQueueSigned: rows.filter((row) => row.secondQueueSigned).length,
    readyForJuneInvoice: rows.filter((row) => row.readyForJuneInvoice).length,
    blockers: rows.filter((row) => row.blockers).length
  };

  if (jsonOutput) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }

  const reportDir = path.resolve(process.cwd(), 'storage', 'audits');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const reportPath = path.join(reportDir, `june-document-readiness-${monthKey}-${timestamp}.csv`);
  const headers = Object.keys(rows[0] ?? {
    creatorUserId: '',
    telegramId: '',
    username: '',
    name: '',
    blockers: ''
  });

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(
    reportPath,
    [headers, ...rows.map((row) => headers.map((header) => row[header as keyof typeof row]))]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n'),
    'utf8'
  );

  console.log('JUNE DOCUMENT READINESS AUDIT');
  console.table([summary]);
  console.log(`Report: ${reportPath}`);

  const blockedRows = rows.filter((row) => row.blockers);
  console.log('\nBLOCKERS');
  console.table(
    blockedRows.slice(0, 50).map((row) => ({
      name: row.name,
      username: row.username,
      contractStartDate: row.contractStartDate,
      firstQueueReady: row.firstQueueReady,
      statisticsReady: row.statisticsReady,
      secondQueueGenerated: row.secondQueueGenerated,
      secondQueueSigned: row.secondQueueSigned,
      blockers: row.blockers
    }))
  );
};

main()
  .catch((error) => {
    console.error('June document readiness audit failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
