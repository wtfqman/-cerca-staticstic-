UPDATE "CreatorProfile"
SET "registrationAddress" = "address"
WHERE ("registrationAddress" IS NULL OR BTRIM("registrationAddress") = '')
  AND "address" IS NOT NULL
  AND BTRIM("address") <> '';

UPDATE "CreatorProfile"
SET "passportIssuedByInstrumental" = "passportIssuedBy"
WHERE ("passportIssuedByInstrumental" IS NULL OR BTRIM("passportIssuedByInstrumental") = '')
  AND "passportIssuedBy" IS NOT NULL
  AND BTRIM("passportIssuedBy") <> '';

ALTER TABLE "CreatorProfile"
  DROP COLUMN "address",
  DROP COLUMN "passportIssuedBy";
