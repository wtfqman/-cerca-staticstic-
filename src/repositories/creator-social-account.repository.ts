import type { SocialPlatform } from '@prisma/client';

import { prisma } from '../lib/prisma';

export interface CreatorSocialAccountInput {
  platform: SocialPlatform;
  handleOrUrl: string;
}

export class CreatorSocialAccountRepository {
  async listByCreatorUserId(creatorUserId: string) {
    return prisma.creatorSocialAccount.findMany({
      where: {
        creatorUserId,
        isActive: true
      },
      orderBy: {
        platform: 'asc'
      }
    });
  }

  async listByCreatorUserIds(creatorUserIds: string[]) {
    if (!creatorUserIds.length) {
      return [];
    }

    return prisma.creatorSocialAccount.findMany({
      where: {
        creatorUserId: {
          in: creatorUserIds
        },
        isActive: true
      }
    });
  }

  async upsertMany(creatorUserId: string, accounts: CreatorSocialAccountInput[]) {
    if (!accounts.length) {
      return [];
    }

    return prisma.$transaction(
      accounts.map((account) =>
        prisma.creatorSocialAccount.upsert({
          where: {
            creatorUserId_platform: {
              creatorUserId,
              platform: account.platform
            }
          },
          create: {
            creatorUserId,
            platform: account.platform,
            handleOrUrl: account.handleOrUrl,
            isActive: true
          },
          update: {
            handleOrUrl: account.handleOrUrl,
            isActive: true
          }
        })
      )
    );
  }
}
