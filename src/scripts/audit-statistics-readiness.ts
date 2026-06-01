import {
  DocumentStatus,
  DocumentType,
  DocumentWorkflowQueue,
  PaymentDocumentStatus,
  PaymentDocumentType,
  UserRole,
  WeeklyReportStatus
} from '@prisma/client';

import {
  SECOND_QUEUE_DOCUMENT_TYPES,
  getActiveRosterResigningCampaignKey,
  getCreatorInvoiceMonthKey,
  getNoContractPaymentCampaignKey
} from '../documents/document-workflow.constants';
import { prisma } from '../lib/prisma';
import { formatCreatorDisplayName } from '../utils/formatters';

const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

const SUBMITTED_WEEKLY_STATUSES = new Set<WeeklyReportStatus>([
  WeeklyReportStatus.SUBMITTED,
  WeeklyReportStatus.CONFIRMED
]);

const MIN_REQUIRED_SCREENSHOT_COUNT = 1;

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

const monthKey = getArgValue('--month') ?? getCreatorInvoiceMonthKey();
const jsonOutput = process.argv.includes('--json');

const hasSignedWorkflowDocument = (
  state: {
    documents: Array<{
      queue: DocumentWorkflowQueue;
      required: boolean;
      document: {
        type: DocumentType;
        monthKey: string | null;
        status: DocumentStatus;
      };
    }>;
  } | null,
  queue: DocumentWorkflowQueue,
  type: DocumentType,
  documentMonthKey: string | null
) =>
  Boolean(
    state?.documents.some(
      (link) =>
        link.required &&
        link.queue === queue &&
        link.document.type === type &&
        (link.document.monthKey ?? null) === documentMonthKey &&
        SIGNED_DOCUMENT_STATUSES.has(link.document.status)
    )
  );

const getNextStep = (input: {
  monthlyVideoSubmitted: boolean;
  hasReach: boolean;
  screenshotCount: number;
  requiredScreenshotCount: number;
  isNoContract: boolean;
  firstQueueSigned: boolean;
  secondQueueSigned: boolean;
  invoiceUploaded: boolean;
}) => {
  if (!input.monthlyVideoSubmitted) {
    return 'enter_monthly_video';
  }

  if (!input.hasReach) {
    return 'enter_weekly_reach';
  }

  if (input.screenshotCount < input.requiredScreenshotCount) {
    return 'upload_stat_screenshots';
  }

  if (input.isNoContract) {
    return input.invoiceUploaded ? 'invoice_uploaded_wait_receipt' : 'upload_invoice';
  }

  if (!input.firstQueueSigned) {
    return 'sign_first_queue';
  }

  if (!input.secondQueueSigned) {
    return 'generate_and_sign_second_queue';
  }

  return input.invoiceUploaded ? 'invoice_uploaded_wait_receipt' : 'upload_invoice';
};

async function main() {
  const users = await prisma.user.findMany({
    where: activeCreatorWhere,
    include: {
      creatorProfile: true,
      monthlyVideoCounts: {
        where: { monthKey }
      },
      weeklyStatReports: {
        where: { monthKey },
        include: {
          items: true,
          attachments: true
        },
        orderBy: {
          weekStart: 'asc'
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
    const reports = user.weeklyStatReports.filter((report) =>
      SUBMITTED_WEEKLY_STATUSES.has(report.status)
    );
    const platformsWithReach = new Set(
      reports.flatMap((report) =>
        report.items
          .filter((item) => item.views > 0)
          .map((item) => item.platform)
      )
    );
    const screenshotCount = reports.reduce((sum, report) => sum + report.attachments.length, 0);
    const requiredScreenshotCount = Math.max(MIN_REQUIRED_SCREENSHOT_COUNT, platformsWithReach.size);
    const monthlyVideoSubmitted = Boolean(user.monthlyVideoCounts[0]);
    const hasReach = platformsWithReach.size > 0;
    const statisticsReady = monthlyVideoSubmitted && hasReach && screenshotCount >= requiredScreenshotCount;
    const activeRosterState =
      user.documentWorkflowStates.find((state) => state.campaign.key === getActiveRosterResigningCampaignKey(monthKey)) ??
      null;
    const noContractState =
      user.documentWorkflowStates.find((state) => state.campaign.key === getNoContractPaymentCampaignKey(monthKey)) ??
      null;
    const isNoContract =
      user.creatorProfile?.profileCompleted === true && user.creatorProfile.legalType === null;
    const firstQueueSigned =
      isNoContract ||
      (
        hasSignedWorkflowDocument(activeRosterState, DocumentWorkflowQueue.FIRST_QUEUE, DocumentType.CONTRACT, null) &&
        hasSignedWorkflowDocument(activeRosterState, DocumentWorkflowQueue.FIRST_QUEUE, DocumentType.NDA, null)
      );
    const secondQueueSigned =
      isNoContract ||
      SECOND_QUEUE_DOCUMENT_TYPES.every((type) =>
        hasSignedWorkflowDocument(activeRosterState, DocumentWorkflowQueue.SECOND_QUEUE, type, monthKey)
      );
    const uploads = user.documentWorkflowStates.flatMap((state) => state.paymentUploads);
    const invoiceUploaded = uploads.some(
      (upload) =>
        upload.type === PaymentDocumentType.INVOICE &&
        upload.monthKey === monthKey &&
        upload.status !== PaymentDocumentStatus.REJECTED
    );
    const receiptUploaded = uploads.some(
      (upload) =>
        upload.type === PaymentDocumentType.RECEIPT &&
        upload.monthKey === monthKey &&
        upload.status !== PaymentDocumentStatus.REJECTED
    );
    const invoiceAllowedNow = statisticsReady && (isNoContract || secondQueueSigned);
    const nextStep = getNextStep({
      monthlyVideoSubmitted,
      hasReach,
      screenshotCount,
      requiredScreenshotCount,
      isNoContract,
      firstQueueSigned,
      secondQueueSigned,
      invoiceUploaded
    });

    return {
      creatorUserId: user.id,
      telegramId: user.telegramId,
      username: user.username,
      name: formatCreatorDisplayName(user),
      role: user.role,
      profileCompleted: user.creatorProfile?.profileCompleted ?? false,
      legalType: user.creatorProfile?.legalType ?? null,
      scenario: isNoContract ? 'NO_CONTRACT' : 'ACTIVE_ROSTER',
      workflowPrepared: Boolean(isNoContract ? noContractState : activeRosterState),
      monthlyVideoSubmitted,
      monthlyVideoCount: user.monthlyVideoCounts[0]?.videoCount ?? null,
      submittedReportCount: reports.length,
      platformsWithReach: [...platformsWithReach].sort(),
      hasReach,
      screenshotCount,
      requiredScreenshotCount,
      statisticsReady,
      firstQueueSigned,
      secondQueueSigned,
      invoiceAllowedNow,
      invoiceUploaded,
      receiptUploaded,
      nextStep
    };
  });

  const summary = {
    monthKey,
    activeCreators: rows.length,
    statisticsReady: rows.filter((row) => row.statisticsReady).length,
    blockedByMonthlyVideo: rows.filter((row) => !row.monthlyVideoSubmitted).length,
    blockedByReach: rows.filter((row) => row.monthlyVideoSubmitted && !row.hasReach).length,
    blockedByScreenshots: rows.filter(
      (row) => row.hasReach && row.screenshotCount < row.requiredScreenshotCount
    ).length,
    invoiceAllowedNow: rows.filter((row) => row.invoiceAllowedNow).length,
    invoicesUploaded: rows.filter((row) => row.invoiceUploaded).length,
    receiptsUploaded: rows.filter((row) => row.receiptUploaded).length
  };

  if (jsonOutput) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }

  console.log('STATISTICS READINESS AUDIT');
  console.table([summary]);

  console.log('\nCREATORS');
  console.table(
    rows.map((row) => ({
      name: row.name,
      username: row.username,
      scenario: row.scenario,
      monthlyVideo: row.monthlyVideoCount,
      reports: row.submittedReportCount,
      reachPlatforms: row.platformsWithReach.join(', '),
      screenshots: `${row.screenshotCount}/${row.requiredScreenshotCount}`,
      statisticsReady: row.statisticsReady,
      firstQueueSigned: row.firstQueueSigned,
      secondQueueSigned: row.secondQueueSigned,
      invoiceAllowedNow: row.invoiceAllowedNow,
      invoiceUploaded: row.invoiceUploaded,
      nextStep: row.nextStep
    }))
  );
}

main()
  .catch((error) => {
    console.error('Statistics readiness audit failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
