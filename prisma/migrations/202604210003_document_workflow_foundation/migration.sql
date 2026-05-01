CREATE TYPE "DocumentWorkflowCampaignType" AS ENUM ('ACTIVE_ROSTER_RESIGNING', 'REGULAR');

CREATE TYPE "DocumentWorkflowCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TYPE "CreatorDocumentWorkflowStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TYPE "DocumentWorkflowQueue" AS ENUM ('FIRST_QUEUE', 'SECOND_QUEUE', 'PAYMENT_QUEUE', 'RECEIPT_QUEUE');

CREATE TYPE "PaymentDocumentType" AS ENUM ('INVOICE', 'RECEIPT');

CREATE TYPE "PaymentDocumentStatus" AS ENUM ('UPLOADED', 'ACCEPTED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_RECEIPT_REMINDER';

CREATE TABLE "DocumentWorkflowCampaign" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "DocumentWorkflowCampaignType" NOT NULL,
    "status" "DocumentWorkflowCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contractDate" DATE,
    "periodMonths" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentWorkflowCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorDocumentWorkflowState" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "status" "CreatorDocumentWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstQueueCompletedAt" TIMESTAMP(3),
    "actSignedAt" TIMESTAMP(3),
    "invoiceAvailableAt" TIMESTAMP(3),
    "invoiceUploadedAt" TIMESTAMP(3),
    "receiptExpectedAt" TIMESTAMP(3),
    "receiptReminderDueAt" TIMESTAMP(3),
    "receiptReminderSentAt" TIMESTAMP(3),
    "receiptUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorDocumentWorkflowState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentWorkflowDocument" (
    "id" TEXT NOT NULL,
    "workflowStateId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "queue" "DocumentWorkflowQueue" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentWorkflowDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDocumentUpload" (
    "id" TEXT NOT NULL,
    "workflowStateId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "type" "PaymentDocumentType" NOT NULL,
    "status" "PaymentDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "telegramFileId" TEXT,
    "telegramDocumentId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "filePath" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDocumentUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentWorkflowCampaign_key_key" ON "DocumentWorkflowCampaign"("key");
CREATE INDEX "DocumentWorkflowCampaign_type_status_idx" ON "DocumentWorkflowCampaign"("type", "status");
CREATE INDEX "DocumentWorkflowCampaign_status_updatedAt_idx" ON "DocumentWorkflowCampaign"("status", "updatedAt");

CREATE UNIQUE INDEX "CreatorDocumentWorkflowState_campaignId_creatorUserId_key" ON "CreatorDocumentWorkflowState"("campaignId", "creatorUserId");
CREATE INDEX "CreatorDocumentWorkflowState_creatorUserId_status_idx" ON "CreatorDocumentWorkflowState"("creatorUserId", "status");
CREATE INDEX "CreatorDocumentWorkflowState_campaignId_status_idx" ON "CreatorDocumentWorkflowState"("campaignId", "status");
CREATE INDEX "CreatorDocumentWorkflowState_receiptReminderDueAt_receiptReminderSentAt_receiptUploadedAt_idx" ON "CreatorDocumentWorkflowState"("receiptReminderDueAt", "receiptReminderSentAt", "receiptUploadedAt");

CREATE UNIQUE INDEX "DocumentWorkflowDocument_workflowStateId_documentId_key" ON "DocumentWorkflowDocument"("workflowStateId", "documentId");
CREATE INDEX "DocumentWorkflowDocument_workflowStateId_queue_idx" ON "DocumentWorkflowDocument"("workflowStateId", "queue");
CREATE INDEX "DocumentWorkflowDocument_documentId_idx" ON "DocumentWorkflowDocument"("documentId");

CREATE INDEX "PaymentDocumentUpload_workflowStateId_type_uploadedAt_idx" ON "PaymentDocumentUpload"("workflowStateId", "type", "uploadedAt");
CREATE INDEX "PaymentDocumentUpload_creatorUserId_type_uploadedAt_idx" ON "PaymentDocumentUpload"("creatorUserId", "type", "uploadedAt");

ALTER TABLE "CreatorDocumentWorkflowState"
ADD CONSTRAINT "CreatorDocumentWorkflowState_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "DocumentWorkflowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreatorDocumentWorkflowState"
ADD CONSTRAINT "CreatorDocumentWorkflowState_creatorUserId_fkey"
FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentWorkflowDocument"
ADD CONSTRAINT "DocumentWorkflowDocument_workflowStateId_fkey"
FOREIGN KEY ("workflowStateId") REFERENCES "CreatorDocumentWorkflowState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentWorkflowDocument"
ADD CONSTRAINT "DocumentWorkflowDocument_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDocumentUpload"
ADD CONSTRAINT "PaymentDocumentUpload_workflowStateId_fkey"
FOREIGN KEY ("workflowStateId") REFERENCES "CreatorDocumentWorkflowState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDocumentUpload"
ADD CONSTRAINT "PaymentDocumentUpload_creatorUserId_fkey"
FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
