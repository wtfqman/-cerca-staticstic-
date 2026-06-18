import 'dotenv/config';

import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const TELEGRAM_ID_PATTERN = /^-?\d+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{5,32}$/;

type TargetLocator =
  | {
      kind: 'telegramId';
      value: string;
      label: string;
    }
  | {
      kind: 'username';
      value: string;
      label: string;
    };

const getTargetLocator = (): TargetLocator => {
  const rawTarget = process.argv[2]?.trim();

  if (!rawTarget) {
    throw new Error('Usage: npm run reset:test-creator -- <telegramId|@username>');
  }

  if (TELEGRAM_ID_PATTERN.test(rawTarget)) {
    return {
      kind: 'telegramId',
      value: rawTarget,
      label: rawTarget
    };
  }

  const username = rawTarget.replace(/^@/, '').trim();

  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(`Invalid target: ${rawTarget}. Use numeric Telegram ID or @username.`);
  }

  return {
    kind: 'username',
    value: username,
    label: `@${username}`
  };
};

const run = async () => {
  const locator = getTargetLocator();

  const result = await prisma.$transaction(async (tx) => {
    const matchedUsers =
      locator.kind === 'telegramId'
        ? await tx.user.findMany({
            where: { telegramId: locator.value },
            select: {
              id: true,
              telegramId: true,
              role: true,
              isActive: true
            }
          })
        : await tx.user.findMany({
            where: {
              username: {
                equals: locator.value,
                mode: 'insensitive'
              }
            },
            select: {
              id: true,
              telegramId: true,
              role: true,
              isActive: true
            }
          });

    if (matchedUsers.length > 1) {
      throw new Error(`Target ${locator.label} matched ${matchedUsers.length} users. Use Telegram ID instead.`);
    }

    const existingUser = matchedUsers[0];

    if (!existingUser && locator.kind === 'username') {
      throw new Error(`User ${locator.label} was not found. Ask them to press /start or use Telegram ID.`);
    }

    const roleAfterReset = existingUser?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.CREATOR;

    const user = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            role: roleAfterReset,
            isActive: true
          },
          select: {
            id: true,
            telegramId: true,
            role: true,
            isActive: true
          }
        })
      : await tx.user.create({
          data: {
            telegramId: locator.value,
            role: UserRole.CREATOR,
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
          startsWith: `${user.telegramId}:`
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

    const notificationLogs = await tx.notificationLog.deleteMany({
      where: {
        userId: user.id
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

    const creatorProfileChangeRequests = await tx.creatorProfileChangeRequest.deleteMany({
      where: {
        OR: [
          {
            creatorUserId: user.id
          },
          {
            teamLeadUserId: user.id
          }
        ]
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
      locator,
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
        notificationLogs: notificationLogs.count,
        paymentUploads: paymentUploads.count,
        workflowLinks: workflowLinks.count,
        workflowStates: workflowStates.count,
        signatureUploads: signatureUploads.count,
        documents: documents.count,
        creatorSocialAccounts: creatorSocialAccounts.count,
        creatorProfileChangeLogs: creatorProfileChangeLogs.count,
        creatorProfileChangeRequests: creatorProfileChangeRequests.count,
        creatorProfiles: creatorProfiles.count,
        teamLeadProfiles: teamLeadProfiles.count
      }
    };
  });

  console.log(
    `Test creator reset completed: target=${result.locator.label}, telegramId=${result.user.telegramId}, userId=${result.user.id}`
  );
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
