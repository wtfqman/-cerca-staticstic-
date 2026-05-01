import { UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';

const creatorAccessWhere = {
  isActive: true,
  OR: [
    { role: UserRole.CREATOR },
    {
      creatorProfile: {
        isNot: null
      }
    }
  ]
};

const teamLeadAccessWhere = {
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

export class TeamLeadRepository {
  async assignCreatorToTeamLead(creatorUserId: string, teamLeadUserId: string) {
    return prisma.$transaction(async (tx) => {
      const [creator, teamLead, previousActiveLink] = await Promise.all([
        tx.user.findFirst({
          where: {
            id: creatorUserId,
            ...creatorAccessWhere
          },
          include: {
            creatorProfile: true
          }
        }),
        tx.user.findFirst({
          where: {
            id: teamLeadUserId,
            ...teamLeadAccessWhere
          },
          include: {
            teamLeadProfile: true
          }
        }),
        tx.creatorTeamLeadLink.findFirst({
          where: {
            creatorUserId,
            isActive: true
          },
          include: {
            teamLead: {
              include: {
                teamLeadProfile: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        })
      ]);

      if (!creator) {
        throw new Error('Креатор не найден или не активен.');
      }

      if (!teamLead) {
        throw new Error('Тимлид не найден или не активен.');
      }

      await tx.creatorTeamLeadLink.updateMany({
        where: {
          creatorUserId,
          isActive: true,
          teamLeadUserId: {
            not: teamLeadUserId
          }
        },
        data: {
          isActive: false
        }
      });

      const link = await tx.creatorTeamLeadLink.upsert({
        where: {
          creatorUserId_teamLeadUserId: {
            creatorUserId,
            teamLeadUserId
          }
        },
        create: {
          creatorUserId,
          teamLeadUserId,
          isActive: true
        },
        update: {
          isActive: true
        },
        include: {
          creator: {
            include: {
              creatorProfile: true
            }
          },
          teamLead: {
            include: {
              teamLeadProfile: true
            }
          }
        }
      });

      return {
        link,
        previousTeamLead:
          previousActiveLink && previousActiveLink.teamLeadUserId !== teamLeadUserId
            ? previousActiveLink.teamLead
            : null
      };
    });
  }

  async getActiveTeamLeadForCreator(creatorUserId: string) {
    return prisma.creatorTeamLeadLink.findFirst({
      where: {
        creatorUserId,
        isActive: true,
        teamLead: {
          is: teamLeadAccessWhere
        }
      },
      include: {
        teamLead: {
          include: {
            teamLeadProfile: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async listCreatorsForTeamLead(teamLeadUserId: string) {
    return prisma.creatorTeamLeadLink.findMany({
      where: {
        teamLeadUserId,
        isActive: true,
        creator: {
          is: creatorAccessWhere
        },
        teamLead: {
          is: teamLeadAccessWhere
        }
      },
      include: {
        creator: {
          include: {
            creatorProfile: true,
            creatorAssignments: {
              where: { isActive: true },
              orderBy: { createdAt: 'desc' },
              include: {
                teamLead: {
                  include: {
                    teamLeadProfile: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
  }

  async listUnassignedCreators() {
    return prisma.user.findMany({
      where: {
        ...creatorAccessWhere,
        creatorAssignments: {
          none: {
            isActive: true
          }
        }
      },
      include: {
        creatorProfile: true,
        creatorAssignments: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          include: {
            teamLead: {
              include: {
                teamLeadProfile: true
              }
            }
          }
        }
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
  }

  async listGroups() {
    return prisma.creatorTeamLeadLink.findMany({
      where: {
        isActive: true,
        creator: {
          is: creatorAccessWhere
        },
        teamLead: {
          is: teamLeadAccessWhere
        }
      },
      include: {
        teamLead: {
          include: {
            teamLeadProfile: true
          }
        },
        creator: {
          include: {
            creatorProfile: true,
            creatorAssignments: {
              where: { isActive: true },
              orderBy: { createdAt: 'desc' },
              include: {
                teamLead: {
                  include: {
                    teamLeadProfile: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
  }
}
