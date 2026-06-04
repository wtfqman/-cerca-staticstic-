import fs from 'node:fs';

import {
  DocumentStatus,
  DocumentType,
  DocumentWorkflowQueue,
  PaymentDocumentStatus,
  PaymentDocumentType,
  UserRole
} from '@prisma/client';

import { config } from '../config';
import {
  SECOND_QUEUE_DOCUMENT_TYPES,
  getActiveRosterResigningCampaignKey,
  getCreatorInvoiceMonthKey,
  getNoContractPaymentCampaignKey,
  isCreatorInvoiceMonth
} from '../documents/document-workflow.constants';
import { prisma } from '../lib/prisma';
import { getCreatorInvoiceDisplayAmount } from '../payments/payment.constants';
import { container } from '../container';

const SIGNED_DOCUMENT_STATUSES = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

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

const maskDbUrl = (url: string) => url.replace(/:\/\/[^@]+@/, '://***@');

const formatName = (user: {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  creatorProfile: { fullName: string | null } | null;
}) => {
  const telegramName = [user.firstName, user.lastName].filter(Boolean).join(' ');

  return user.creatorProfile?.fullName || telegramName || user.username || user.telegramId;
};

const getLatestActiveUpload = <
  T extends {
    type: PaymentDocumentType;
    status: PaymentDocumentStatus;
    monthKey: string | null;
    uploadedAt: Date;
  }
>(
  uploads: T[],
  type: PaymentDocumentType
) =>
  uploads
    .filter(
      (upload) =>
        upload.type === type &&
        upload.monthKey === monthKey &&
        upload.status !== PaymentDocumentStatus.REJECTED
    )
    .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())[0] ?? null;

const checkFile = (filePath?: string | null) => {
  if (!filePath) {
    return { ok: false, issue: 'NO_PATH' as const, size: 0, isPdf: false };
  }

  if (!fs.existsSync(filePath)) {
    return { ok: false, issue: 'MISSING_FILE' as const, size: 0, isPdf: false };
  }

  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(4);

  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);

  const isPdf = header.toString('utf8') === '%PDF';

  return {
    ok: stat.size > 0 && isPdf,
    issue: stat.size <= 0 ? ('EMPTY_FILE' as const) : isPdf ? null : ('NOT_PDF_HEADER' as const),
    size: stat.size,
    isPdf
  };
};

const hasSignedSecondQueueDocument = (
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
  type: DocumentType
) =>
  Boolean(
    state?.documents.some(
      (link) =>
        link.required &&
        link.queue === DocumentWorkflowQueue.SECOND_QUEUE &&
        link.document.type === type &&
        link.document.monthKey === monthKey &&
        SIGNED_DOCUMENT_STATUSES.has(link.document.status)
    )
  );

const getSecondQueueStatus = (
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
  } | null
) => {
  const statuses = Object.fromEntries(
    SECOND_QUEUE_DOCUMENT_TYPES.map((type) => [
      type,
      hasSignedSecondQueueDocument(state, type) ? 'SIGNED' : 'MISSING_OR_UNSIGNED'
    ])
  );

  return {
    signed: SECOND_QUEUE_DOCUMENT_TYPES.every((type) => statuses[type] === 'SIGNED'),
    statuses
  };
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
        where: { monthKey }
      },
      documentWorkflowStates: {
        include: {
          campaign: true,
          documents: {
            include: {
              document: true
            }
          },
          paymentUploads: {
            orderBy: { uploadedAt: 'desc' }
          }
        }
      }
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { createdAt: 'asc' }]
  });

  const rows = [];

  for (const user of users) {
    const activeRosterState =
      user.documentWorkflowStates.find((state) => state.campaign.key === getActiveRosterResigningCampaignKey(monthKey)) ?? null;
    const noContractState =
      user.documentWorkflowStates.find((state) => state.campaign.key === getNoContractPaymentCampaignKey(monthKey)) ?? null;
    const isNoContract =
      user.creatorProfile?.profileCompleted === true && user.creatorProfile.legalType === null;
    const workflowState = isNoContract ? noContractState : activeRosterState;
    const secondQueue = getSecondQueueStatus(activeRosterState);
    const uploads = user.documentWorkflowStates.flatMap((state) => state.paymentUploads);
    const activeInvoices = uploads.filter(
      (upload) =>
        upload.type === PaymentDocumentType.INVOICE &&
        upload.monthKey === monthKey &&
        upload.status !== PaymentDocumentStatus.REJECTED
    );
    const rejectedInvoices = uploads.filter(
      (upload) =>
        upload.type === PaymentDocumentType.INVOICE &&
        upload.monthKey === monthKey &&
        upload.status === PaymentDocumentStatus.REJECTED
    );
    const latestInvoice = getLatestActiveUpload(uploads, PaymentDocumentType.INVOICE);
    const latestReceipt = getLatestActiveUpload(uploads, PaymentDocumentType.RECEIPT);
    const file = checkFile(latestInvoice?.filePath);
    const readyForInvoice = isNoContract || secondQueue.signed;
    let basePayment: number | null = null;
    let invoiceAmount: number | null = null;
    let paymentError: string | null = null;

    try {
      const payment = await container.services.paymentCalculationService.calculateForCreatorMonth(user.id, monthKey, {
        submittedOnly: true,
        persistSnapshot: false
      });

      basePayment = payment.totalPayment;
      invoiceAmount = isCreatorInvoiceMonth(monthKey)
        ? getCreatorInvoiceDisplayAmount(payment.totalPayment)
        : payment.totalPayment;
    } catch (error) {
      paymentError = error instanceof Error ? error.message : String(error);
    }

    rows.push({
      creatorUserId: user.id,
      telegramId: user.telegramId,
      username: user.username,
      name: formatName(user),
      role: user.role,
      profileCompleted: user.creatorProfile?.profileCompleted ?? false,
      legalType: user.creatorProfile?.legalType ?? null,
      scenario: isNoContract ? 'NO_CONTRACT' : 'ACTIVE_ROSTER',
      workflowPrepared: Boolean(workflowState),
      readyForInvoice,
      secondQueueSigned: secondQueue.signed,
      secondQueueDocuments: secondQueue.statuses,
      monthlyVideoCount: user.monthlyVideoCounts[0]?.videoCount ?? null,
      weeklyReportCount: user.weeklyStatReports.length,
      basePayment,
      invoiceAmount,
      paymentError,
      invoiceUploaded: Boolean(latestInvoice),
      invoiceUploadedAt: latestInvoice?.uploadedAt.toISOString() ?? null,
      invoiceStatus: latestInvoice?.status ?? null,
      invoiceOriginalFileName: latestInvoice?.originalFileName ?? null,
      invoiceFilePath: latestInvoice?.filePath ?? null,
      invoiceFileOk: latestInvoice ? file.ok : null,
      invoiceFileIssue: latestInvoice ? file.issue : null,
      invoiceFileSize: latestInvoice ? file.size : null,
      activeInvoiceCount: activeInvoices.length,
      rejectedInvoiceCount: rejectedInvoices.length,
      receiptUploaded: Boolean(latestReceipt),
      receiptUploadedAt: latestReceipt?.uploadedAt.toISOString() ?? null,
      needsAttention:
        (readyForInvoice && !latestInvoice) ||
        Boolean(latestInvoice && !file.ok) ||
        activeInvoices.length > 1 ||
        Boolean(paymentError)
    });
  }

  const summary = {
    db: maskDbUrl(config.db.url),
    monthKey,
    activeCreators: rows.length,
    readyForInvoice: rows.filter((row) => row.readyForInvoice).length,
    uploadedInvoices: rows.filter((row) => row.invoiceUploaded).length,
    missingReadyInvoices: rows.filter((row) => row.readyForInvoice && !row.invoiceUploaded).length,
    blockedBySecondQueue: rows.filter((row) => !row.readyForInvoice).length,
    brokenInvoiceFiles: rows.filter((row) => row.invoiceUploaded && row.invoiceFileOk === false).length,
    duplicateActiveInvoices: rows.filter((row) => row.activeInvoiceCount > 1).length,
    receiptsUploaded: rows.filter((row) => row.receiptUploaded).length,
    paymentCalculationErrors: rows.filter((row) => row.paymentError).length
  };

  if (jsonOutput) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }

  console.log('PAYMENT DOCUMENT AUDIT');
  console.table([summary]);

  const missingReady = rows.filter((row) => row.readyForInvoice && !row.invoiceUploaded);
  const brokenFiles = rows.filter((row) => row.invoiceUploaded && row.invoiceFileOk === false);
  const duplicates = rows.filter((row) => row.activeInvoiceCount > 1);
  const uploaded = rows.filter((row) => row.invoiceUploaded);
  const blocked = rows.filter((row) => !row.readyForInvoice);

  console.log('\nMISSING_READY_INVOICES');
  console.table(
    missingReady.map((row) => ({
      name: row.name,
      username: row.username,
      scenario: row.scenario,
      monthlyVideoCount: row.monthlyVideoCount,
      weeklyReportCount: row.weeklyReportCount,
      invoiceAmount: row.invoiceAmount,
      paymentError: row.paymentError
    }))
  );

  console.log('\nBROKEN_INVOICE_FILES');
  console.table(
    brokenFiles.map((row) => ({
      name: row.name,
      username: row.username,
      issue: row.invoiceFileIssue,
      filePath: row.invoiceFilePath,
      uploadedAt: row.invoiceUploadedAt,
      originalFileName: row.invoiceOriginalFileName
    }))
  );

  console.log('\nDUPLICATE_ACTIVE_INVOICES');
  console.table(
    duplicates.map((row) => ({
      name: row.name,
      username: row.username,
      activeInvoiceCount: row.activeInvoiceCount,
      latestUploadedAt: row.invoiceUploadedAt,
      latestFile: row.invoiceOriginalFileName
    }))
  );

  console.log('\nUPLOADED_INVOICES');
  console.table(
    uploaded.map((row) => ({
      name: row.name,
      username: row.username,
      uploadedAt: row.invoiceUploadedAt,
      fileOk: row.invoiceFileOk,
      size: row.invoiceFileSize,
      invoiceAmount: row.invoiceAmount,
      receiptUploaded: row.receiptUploaded
    }))
  );

  console.log('\nBLOCKED_BY_SECOND_QUEUE');
  console.table(
    blocked.map((row) => ({
      name: row.name,
      username: row.username,
      profileCompleted: row.profileCompleted,
      legalType: row.legalType,
      assignment: row.secondQueueDocuments[DocumentType.ASSIGNMENT],
      act: row.secondQueueDocuments[DocumentType.ACT],
      act1000: row.secondQueueDocuments[DocumentType.ACT_1000],
      invoiceUploaded: row.invoiceUploaded
    }))
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
