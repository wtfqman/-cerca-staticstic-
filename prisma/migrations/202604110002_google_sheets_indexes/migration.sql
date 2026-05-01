-- Indexes for Google Sheets sync, dashboard summaries and document status checks
CREATE INDEX "WeeklyStatReport_monthKey_status_idx" ON "WeeklyStatReport"("monthKey", "status");
CREATE INDEX "MonthlyVideoCount_monthKey_updatedAt_idx" ON "MonthlyVideoCount"("monthKey", "updatedAt");
CREATE INDEX "MonthlyPaymentSnapshot_monthKey_updatedAt_idx" ON "MonthlyPaymentSnapshot"("monthKey", "updatedAt");
CREATE INDEX "Document_creatorUserId_monthKey_type_status_idx" ON "Document"("creatorUserId", "monthKey", "type", "status");
CREATE INDEX "DocumentSignatureUpload_creatorUserId_uploadedAt_idx" ON "DocumentSignatureUpload"("creatorUserId", "uploadedAt");
