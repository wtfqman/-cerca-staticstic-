import { UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { userWithRelationsInclude } from '../types/domain';
import { shouldGrantCreatorAccessToTeamLead } from '../utils/teamlead-creator-access';

interface TelegramUserInput {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface TeamLeadUpsertInput extends TelegramUserInput {
  displayName: string;
  grantCreatorAccess?: boolean;
  isActive?: boolean;
}

const activeCreatorWhere = {
  isActive: true,
  OR: [
    { role: UserRole.CREATOR },
    {
      role: UserRole.ADMIN,
      creatorProfile: {
        isNot: null
      }
    },
    {
      role: UserRole.TEAMLEAD,
      creatorProfile: {
        isNot: null
      }
    },
    {
      role: null,
      creatorProfile: {
        isNot: null
      }
    }
  ]
};

const activeTeamLeadWhere = {
  isActive: true,
  OR: [
    { role: UserRole.TEAMLEAD },
    {
      teamLeadProfile: {
        isNot: null
      }
    }
  ]
};

export class UserRepository {
  async findByTelegramId(telegramId: string) {
    return prisma.user.findUnique({
      where: { telegramId },
      include: userWithRelationsInclude
    });
  }

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: userWithRelationsInclude
    });
  }

  async createFromTelegram(input: TelegramUserInput) {
    return prisma.user.create({
      data: {
        telegramId: input.telegramId,
        username: input.username ?? undefined,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined
      },
      include: userWithRelationsInclude
    });
  }

  async createOrUpdateFromTelegram(input: TelegramUserInput) {
    return prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        username: input.username ?? undefined,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined
      },
      update: {
        username: input.username ?? undefined,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined
      },
      include: userWithRelationsInclude
    });
  }

  async updateRole(userId: string, role: UserRole) {
    return prisma.user.update({
      where: { id: userId },
      data: { role },
      include: userWithRelationsInclude
    });
  }

  async setActive(userId: string, isActive: boolean) {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive },
      include: userWithRelationsInclude
    });
  }

  async ensureCreatorProfile(userId: string, options: { resetCompleted?: boolean } = {}) {
    await prisma.creatorProfile.upsert({
      where: { userId },
      create: {
        userId,
        profileCompleted: false
      },
      update: options.resetCompleted ? { profileCompleted: false } : {}
    });

    const user = await this.findById(userId);

    if (!user) {
      throw new Error('User not found after ensuring creator profile');
    }

    return user;
  }

  async upsertTeamLead(input: TeamLeadUpsertInput) {
    const existing = await this.findByTelegramId(input.telegramId);
    const role = existing?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.TEAMLEAD;
    const grantCreatorAccess =
      input.grantCreatorAccess ?? shouldGrantCreatorAccessToTeamLead(input.telegramId);
    const isActive = input.isActive ?? true;

    const user = await prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        role,
        isActive,
        teamLeadProfile: {
          create: {
            displayName: input.displayName
          }
        },
        ...(grantCreatorAccess
          ? {
              creatorProfile: {
                create: {
                  profileCompleted: false
                }
              }
            }
          : {})
      },
      update: {
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        role,
        isActive,
        teamLeadProfile: {
          upsert: {
            create: {
              displayName: input.displayName
            },
            update: {
              displayName: input.displayName
            }
          }
        },
        ...(grantCreatorAccess
          ? {
              creatorProfile: {
                upsert: {
                  create: {
                    profileCompleted: false
                  },
                  update: {}
                }
              }
            }
          : {})
      },
      include: userWithRelationsInclude
    });

    if (!isActive) {
      await prisma.creatorTeamLeadLink.updateMany({
        where: {
          teamLeadUserId: user.id,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
    }

    return user;
  }

  async listByRole(role: UserRole) {
    return prisma.user.findMany({
      where: {
        role,
        isActive: true
      },
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listCreators() {
    return prisma.user.findMany({
      where: activeCreatorWhere,
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listInactiveCreators() {
    return prisma.user.findMany({
      where: {
        isActive: false,
        OR: [
          { role: UserRole.CREATOR },
          {
            creatorProfile: {
              isNot: null
            }
          }
        ]
      },
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listRevokableCreators() {
    return prisma.user.findMany({
      where: {
        isActive: true,
        role: UserRole.CREATOR
      },
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listTeamLeads() {
    return prisma.user.findMany({
      where: activeTeamLeadWhere,
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listCreatorAccessCandidates() {
    return prisma.user.findMany({
      where: {
        isActive: true,
        creatorProfile: null,
        OR: [
          { role: null },
          { role: UserRole.TEAMLEAD },
          {
            teamLeadProfile: {
              isNot: null
            }
          }
        ]
      },
      include: userWithRelationsInclude,
      orderBy: [{ createdAt: 'desc' }]
    });
  }

  async listPendingRole() {
    return prisma.user.findMany({
      where: {
        role: null,
        isActive: true
      },
      include: userWithRelationsInclude,
      orderBy: [{ createdAt: 'desc' }]
    });
  }

  async listByIds(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    return prisma.user.findMany({
      where: {
        id: { in: ids }
      },
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listActiveCreators() {
    return prisma.user.findMany({
      where: activeCreatorWhere,
      include: userWithRelationsInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async getCountsByRole() {
    const [admins, teamLeads, creators] = await Promise.all([
      prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } }),
      prisma.user.count({ where: { role: UserRole.TEAMLEAD, isActive: true } }),
      prisma.user.count({ where: { role: UserRole.CREATOR, isActive: true } })
    ]);

    return { admins, teamLeads, creators };
  }
}
