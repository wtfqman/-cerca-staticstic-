ALTER TABLE "CreatorProfile"
  ADD COLUMN "contractDeadlineDate" DATE,
  ADD COLUMN "passportIssuedByInstrumental" TEXT;

UPDATE "CreatorProfile"
SET "passportIssuedByInstrumental" = "passportIssuedBy"
WHERE "passportIssuedByInstrumental" IS NULL
  AND "passportIssuedBy" IS NOT NULL;

UPDATE "CreatorProfile"
SET "registrationAddress" = "address"
WHERE "registrationAddress" IS NULL
  AND "address" IS NOT NULL;

CREATE TABLE "CreatorProfileChangeLog" (
  "id" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreatorProfileChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreatorProfileChangeLog_creatorUserId_createdAt_idx"
  ON "CreatorProfileChangeLog"("creatorUserId", "createdAt");

CREATE INDEX "CreatorProfileChangeLog_actorUserId_createdAt_idx"
  ON "CreatorProfileChangeLog"("actorUserId", "createdAt");

CREATE INDEX "CreatorProfileChangeLog_field_createdAt_idx"
  ON "CreatorProfileChangeLog"("field", "createdAt");
