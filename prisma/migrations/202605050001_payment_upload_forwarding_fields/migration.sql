ALTER TABLE "PaymentDocumentUpload"
ADD COLUMN "forwardedAt" TIMESTAMP(3),
ADD COLUMN "forwardedChatId" TEXT,
ADD COLUMN "forwardedMessageId" INTEGER;

CREATE INDEX "PaymentUpload_export_pending_idx"
ON "PaymentDocumentUpload"("type", "monthKey", "forwardedChatId", "uploadedAt");
