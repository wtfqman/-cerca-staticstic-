-- CreateEnum
CREATE TYPE "CreatorProfileChangeRequestStatus" AS ENUM (
  'CREATED',
  'PENDING_TEAMLEAD',
  'APPROVED',
  'REJECTED',
  'COMPLETED'
);

-- CreateTable
CREATE TABLE "CreatorProfileChangeRequest" (
  "id" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "teamLeadUserId" TEXT NOT NULL,
  "status" "CreatorProfileChangeRequestStatus" NOT NULL DEFAULT 'PENDING_TEAMLEAD',
  "fields" JSONB NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreatorProfileChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorProfileChangeRequest_creatorUserId_status_idx"
  ON "CreatorProfileChangeRequest"("creatorUserId", "status");

-- CreateIndex
CREATE INDEX "CreatorProfileChangeRequest_teamLeadUserId_status_createdAt_idx"
  ON "CreatorProfileChangeRequest"("teamLeadUserId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CreatorProfileChangeRequest"
  ADD CONSTRAINT "CreatorProfileChangeRequest_creatorUserId_fkey"
  FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfileChangeRequest"
  ADD CONSTRAINT "CreatorProfileChangeRequest_teamLeadUserId_fkey"
  FOREIGN KEY ("teamLeadUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
