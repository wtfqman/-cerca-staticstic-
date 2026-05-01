import { CreatorProfileChangeRequestStatus, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

const requestWithRelations = Prisma.validator<Prisma.CreatorProfileChangeRequestInclude>()({
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
});

export type CreatorProfileChangeRequestWithRelations = Prisma.CreatorProfileChangeRequestGetPayload<{
  include: typeof requestWithRelations;
}>;

const openRequestStatuses = [
  CreatorProfileChangeRequestStatus.CREATED,
  CreatorProfileChangeRequestStatus.PENDING_TEAMLEAD,
  CreatorProfileChangeRequestStatus.APPROVED
];

export class CreatorProfileChangeRequestRepository {
  async create(input: {
    creatorUserId: string;
    teamLeadUserId: string;
    fields: string[];
  }) {
    return prisma.creatorProfileChangeRequest.create({
      data: {
        creatorUserId: input.creatorUserId,
        teamLeadUserId: input.teamLeadUserId,
        status: CreatorProfileChangeRequestStatus.PENDING_TEAMLEAD,
        fields: input.fields
      },
      include: requestWithRelations
    });
  }

  async findById(id: string) {
    return prisma.creatorProfileChangeRequest.findUnique({
      where: { id },
      include: requestWithRelations
    });
  }

  async findOpenByCreator(creatorUserId: string) {
    return prisma.creatorProfileChangeRequest.findFirst({
      where: {
        creatorUserId,
        status: {
          in: openRequestStatuses
        }
      },
      include: requestWithRelations,
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async updateStatus(
    id: string,
    status: CreatorProfileChangeRequestStatus,
    extra: {
      decidedAt?: Date | null;
      completedAt?: Date | null;
    } = {}
  ) {
    return prisma.creatorProfileChangeRequest.update({
      where: { id },
      data: {
        status,
        ...extra
      },
      include: requestWithRelations
    });
  }
}
