import { UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';

const TELEGRAM_ID_PATTERN = /^-?\d+$/;

const getTelegramId = () => {
  const telegramId = process.argv[2]?.trim();

  if (!telegramId) {
    throw new Error('Usage: npm run reset:test-creator -- <telegramId>');
  }

  if (!TELEGRAM_ID_PATTERN.test(telegramId)) {
    throw new Error(`Invalid Telegram ID: ${telegramId}`);
  }

  return telegramId;
};

const run = async () => {
  const telegramId = getTelegramId();

  const result = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { telegramId },
      select: {
        id: true,
        role: true,
        isActive: true
      }
    });

    const roleAfterReset = existingUser?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.CREATOR;

    const user = await tx.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        role: UserRole.CREATOR,
        isActive: true
      },
      update: {
        role: roleAfterReset,
        isActive: true
      },
      select: {
        id: true,
        telegramId: true,
        role: true,
        isActive: true
      }
    });

    const botSessions = await tx.botSession.deleteMany({
      where: {
        key: {
          startsWith: `${telegramId}:`
        }
      }
    });

    const creatorAssignments = await tx.creatorTeamLeadLink.updateMany({
      where: {
        creatorUserId: user.id,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    const teamLeadAssignments = await tx.creatorTeamLeadLink.updateMany({
      where: {
        teamLeadUserId: user.id,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    const weeklyStatAttachments = await tx.weeklyStatAttachment.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const weeklyStatItems = await tx.weeklyStatItem.deleteMany({
      where: {
        report: {
          creatorUserId: user.id
        }
      }
    });

    const weeklyStatReports = await tx.weeklyStatReport.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const monthlyVideoCounts = await tx.monthlyVideoCount.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const monthlyPaymentSnapshots = await tx.monthlyPaymentSnapshot.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const dailyPublicationChecks = await tx.dailyPublicationCheck.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const documentRequests = await tx.documentRequest.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const paymentUploads = await tx.paymentDocumentUpload.deleteMany({
      where: {
        OR: [
          {
            creatorUserId: user.id
          },
          {
            workflowState: {
              creatorUserId: user.id
            }
          }
        ]
      }
    });

    const workflowLinks = await tx.documentWorkflowDocument.deleteMany({
      where: {
        OR: [
          {
            workflowState: {
              creatorUserId: user.id
            }
          },
          {
            document: {
              creatorUserId: user.id
            }
          }
        ]
      }
    });

    const workflowStates = await tx.creatorDocumentWorkflowState.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const signatureUploads = await tx.documentSignatureUpload.deleteMany({
      where: {
        OR: [
          {
            creatorUserId: user.id
          },
          {
            document: {
              creatorUserId: user.id
            }
          }
        ]
      }
    });

    const documents = await tx.document.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const creatorSocialAccounts = await tx.creatorSocialAccount.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const creatorProfileChangeLogs = await tx.creatorProfileChangeLog.deleteMany({
      where: {
        creatorUserId: user.id
      }
    });

    const creatorProfiles = await tx.creatorProfile.deleteMany({
      where: {
        userId: user.id
      }
    });

    const teamLeadProfiles = await tx.teamLeadProfile.deleteMany({
      where: {
        userId: user.id
      }
    });

    return {
      user,
      previousRole: existingUser?.role ?? null,
      previousIsActive: existingUser?.isActive ?? null,
      createdUser: !existingUser,
      reset: {
        botSessions: botSessions.count,
        creatorAssignmentsDeactivated: creatorAssignments.count,
        teamLeadAssignmentsDeactivated: teamLeadAssignments.count,
        weeklyStatAttachments: weeklyStatAttachments.count,
        weeklyStatItems: weeklyStatItems.count,
        weeklyStatReports: weeklyStatReports.count,
        monthlyVideoCounts: monthlyVideoCounts.count,
        monthlyPaymentSnapshots: monthlyPaymentSnapshots.count,
        dailyPublicationChecks: dailyPublicationChecks.count,
        documentRequests: documentRequests.count,
        paymentUploads: paymentUploads.count,
        workflowLinks: workflowLinks.count,
        workflowStates: workflowStates.count,
        signatureUploads: signatureUploads.count,
        documents: documents.count,
        creatorSocialAccounts: creatorSocialAccounts.count,
        creatorProfileChangeLogs: creatorProfileChangeLogs.count,
        creatorProfiles: creatorProfiles.count,
        teamLeadProfiles: teamLeadProfiles.count
      }
    };
  });

  console.log(`Test creator reset completed: telegramId=${result.user.telegramId}, userId=${result.user.id}`);
  console.log(
    result.createdUser
      ? 'User was created as CREATOR.'
      : `User was updated: previousRole=${result.previousRole ?? 'null'}, previousIsActive=${result.previousIsActive}.`
  );
  console.log(`Current state: role=${result.user.role}, isActive=${result.user.isActive}.`);
  console.log('Reset only target-user records:');
  console.log(JSON.stringify(result.reset, null, 2));
};

run()
  .catch((error) => {
    console.error('Test creator reset failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
