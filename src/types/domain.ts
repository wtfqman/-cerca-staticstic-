import { Prisma } from '@prisma/client';

export const userWithRelationsInclude = Prisma.validator<Prisma.UserInclude>()({
  creatorProfile: true,
  teamLeadProfile: true,
  creatorAssignments: {
    where: { isActive: true },
    include: {
      teamLead: {
        include: {
          teamLeadProfile: true
        }
      }
    }
  },
  teamLeadAssignments: {
    where: { isActive: true },
    include: {
      creator: {
        include: {
          creatorProfile: true
        }
      }
    }
  },
  documentWorkflowStates: {
    include: {
      campaign: true
    }
  }
});

export type AppUser = Prisma.UserGetPayload<{
  include: typeof userWithRelationsInclude;
}>;
