-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TEAMLEAD', 'CREATOR');

-- CreateEnum
CREATE TYPE "LegalType" AS ENUM ('SELF_EMPLOYED', 'IP');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'VK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "DailyPublicationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'MISSED');

-- CreateEnum
CREATE TYPE "WeeklyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DAILY_PUBLICATION_REMINDER', 'DAILY_MISSED_TEAMLEAD', 'WEEKLY_STATS_REMINDER', 'DOCUMENT_SENT', 'DOCUMENT_SIGNED_FORWARDED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'NDA', 'ACT', 'ASSIGNMENT', 'RIGHTS_TRANSFER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('GENERATED', 'SENT_TO_CREATOR', 'VIEWED_BY_CREATOR', 'SIGNED_UPLOADED', 'FORWARDED_TO_CHAT', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentRequestType" AS ENUM ('MONTHLY_PACKAGE', 'REGENERATE_ONE_OFF', 'REGENERATE_MONTHLY');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "UserRole",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalType" "LegalType",
    "fullName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "inn" TEXT,
    "passportSeries" TEXT,
    "passportNumber" TEXT,
    "passportIssuedAt" DATE,
    "passportIssuedBy" TEXT,
    "registrationAddress" TEXT,
    "ogrnip" TEXT,
    "bankAccount" TEXT,
    "bankBik" TEXT,
    "bankCorrAccount" TEXT,
    "bankName" TEXT,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeadProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamLeadProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorTeamLeadLink" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "teamLeadUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTeamLeadLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorSocialAccount" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handleOrUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPublicationCheck" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "checkDate" DATE NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "teamLeadNotifiedAt" TIMESTAMP(3),
    "status" "DailyPublicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPublicationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyStatReport" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "status" "WeeklyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyStatReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyStatItem" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyStatItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyVideoCount" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "videoCount" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyVideoCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payloadJson" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequest" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "type" "DocumentRequestType" NOT NULL,
    "periodKey" TEXT,
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPaymentSnapshot" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "rawViews" INTEGER NOT NULL,
    "roundedViews" INTEGER NOT NULL,
    "appliedRate" INTEGER NOT NULL,
    "viewSteps" INTEGER NOT NULL,
    "actualVideoCount" INTEGER NOT NULL,
    "fixedSalaryPart" INTEGER NOT NULL,
    "variablePart" INTEGER NOT NULL,
    "totalPayment" INTEGER NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyPaymentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "legalType" "LegalType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "monthKey" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'GENERATED',
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "telegramMessageId" INTEGER,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedUploadedAt" TIMESTAMP(3),
    "forwardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignatureUpload" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "telegramFileId" TEXT,
    "telegramDocumentId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "filePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardedChatId" TEXT,
    "forwardedMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSignatureUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE INDEX "CreatorProfile_legalType_profileCompleted_idx" ON "CreatorProfile"("legalType", "profileCompleted");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeadProfile_userId_key" ON "TeamLeadProfile"("userId");

-- CreateIndex
CREATE INDEX "CreatorTeamLeadLink_creatorUserId_isActive_idx" ON "CreatorTeamLeadLink"("creatorUserId", "isActive");

-- CreateIndex
CREATE INDEX "CreatorTeamLeadLink_teamLeadUserId_isActive_idx" ON "CreatorTeamLeadLink"("teamLeadUserId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorTeamLeadLink_creatorUserId_teamLeadUserId_key" ON "CreatorTeamLeadLink"("creatorUserId", "teamLeadUserId");

-- CreateIndex
CREATE INDEX "CreatorSocialAccount_creatorUserId_isActive_idx" ON "CreatorSocialAccount"("creatorUserId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorSocialAccount_creatorUserId_platform_key" ON "CreatorSocialAccount"("creatorUserId", "platform");

-- CreateIndex
CREATE INDEX "DailyPublicationCheck_checkDate_status_idx" ON "DailyPublicationCheck"("checkDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPublicationCheck_creatorUserId_checkDate_key" ON "DailyPublicationCheck"("creatorUserId", "checkDate");

-- CreateIndex
CREATE INDEX "WeeklyStatReport_creatorUserId_monthKey_idx" ON "WeeklyStatReport"("creatorUserId", "monthKey");

-- CreateIndex
CREATE INDEX "WeeklyStatReport_weekStart_weekEnd_idx" ON "WeeklyStatReport"("weekStart", "weekEnd");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyStatReport_creatorUserId_weekStart_weekEnd_key" ON "WeeklyStatReport"("creatorUserId", "weekStart", "weekEnd");

-- CreateIndex
CREATE INDEX "WeeklyStatItem_platform_idx" ON "WeeklyStatItem"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyStatItem_weeklyReportId_platform_key" ON "WeeklyStatItem"("weeklyReportId", "platform");

-- CreateIndex
CREATE INDEX "MonthlyVideoCount_monthKey_idx" ON "MonthlyVideoCount"("monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyVideoCount_creatorUserId_monthKey_key" ON "MonthlyVideoCount"("creatorUserId", "monthKey");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_type_createdAt_idx" ON "NotificationLog"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRequest_creatorUserId_type_periodKey_idx" ON "DocumentRequest"("creatorUserId", "type", "periodKey");

-- CreateIndex
CREATE INDEX "MonthlyPaymentSnapshot_monthKey_idx" ON "MonthlyPaymentSnapshot"("monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPaymentSnapshot_creatorUserId_monthKey_key" ON "MonthlyPaymentSnapshot"("creatorUserId", "monthKey");

-- CreateIndex
CREATE INDEX "Document_creatorUserId_status_idx" ON "Document"("creatorUserId", "status");

-- CreateIndex
CREATE INDEX "Document_monthKey_type_idx" ON "Document"("monthKey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Document_creatorUserId_type_scopeKey_key" ON "Document"("creatorUserId", "type", "scopeKey");

-- CreateIndex
CREATE INDEX "DocumentSignatureUpload_documentId_uploadedAt_idx" ON "DocumentSignatureUpload"("documentId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_key_key" ON "BotSession"("key");

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeadProfile" ADD CONSTRAINT "TeamLeadProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTeamLeadLink" ADD CONSTRAINT "CreatorTeamLeadLink_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTeamLeadLink" ADD CONSTRAINT "CreatorTeamLeadLink_teamLeadUserId_fkey" FOREIGN KEY ("teamLeadUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSocialAccount" ADD CONSTRAINT "CreatorSocialAccount_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPublicationCheck" ADD CONSTRAINT "DailyPublicationCheck_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyStatReport" ADD CONSTRAINT "WeeklyStatReport_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyStatItem" ADD CONSTRAINT "WeeklyStatItem_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyStatReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyVideoCount" ADD CONSTRAINT "MonthlyVideoCount_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPaymentSnapshot" ADD CONSTRAINT "MonthlyPaymentSnapshot_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignatureUpload" ADD CONSTRAINT "DocumentSignatureUpload_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignatureUpload" ADD CONSTRAINT "DocumentSignatureUpload_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

