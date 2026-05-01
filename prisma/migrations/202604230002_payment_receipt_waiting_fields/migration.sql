ALTER TABLE "PaymentDocumentUpload"
ADD COLUMN "receiptExpectedAt" TIMESTAMP(3),
ADD COLUMN "receiptReminderDueAt" TIMESTAMP(3),
ADD COLUMN "receiptReminderSentAt" TIMESTAMP(3);

CREATE INDEX "PaymentUpload_receipt_reminder_due_idx"
ON "PaymentDocumentUpload"("type", "receiptReminderDueAt", "receiptReminderSentAt");
