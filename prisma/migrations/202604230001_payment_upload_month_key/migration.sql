ALTER TABLE "PaymentDocumentUpload"
ADD COLUMN "monthKey" TEXT;

CREATE INDEX "PaymentUpload_workflow_month_type_uploaded_idx"
ON "PaymentDocumentUpload"("workflowStateId", "monthKey", "type", "uploadedAt");

CREATE INDEX "PaymentUpload_creator_month_type_uploaded_idx"
ON "PaymentDocumentUpload"("creatorUserId", "monthKey", "type", "uploadedAt");
