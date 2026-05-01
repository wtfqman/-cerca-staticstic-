-- Add nullable review markers for teamlead verification of submitted weekly statistics.
ALTER TABLE "WeeklyStatReport"
ADD COLUMN "reviewedByTeamLeadId" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "WeeklyStatReport_reviewedByTeamLeadId_reviewedAt_idx"
ON "WeeklyStatReport"("reviewedByTeamLeadId", "reviewedAt");

ALTER TABLE "WeeklyStatReport"
ADD CONSTRAINT "WeeklyStatReport_reviewedByTeamLeadId_fkey"
FOREIGN KEY ("reviewedByTeamLeadId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
