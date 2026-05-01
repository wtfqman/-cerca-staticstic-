CREATE TABLE "WeeklyStatAttachment" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "telegramFileUniqueId" TEXT,
    "filePath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyStatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WeeklyStatAttachment_weeklyReportId_sortOrder_idx" ON "WeeklyStatAttachment"("weeklyReportId", "sortOrder");
CREATE INDEX "WeeklyStatAttachment_creatorUserId_uploadedAt_idx" ON "WeeklyStatAttachment"("creatorUserId", "uploadedAt");

ALTER TABLE "WeeklyStatAttachment"
ADD CONSTRAINT "WeeklyStatAttachment_weeklyReportId_fkey"
FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyStatReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyStatAttachment"
ADD CONSTRAINT "WeeklyStatAttachment_creatorUserId_fkey"
FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
