import { LegalType, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

export interface CreatorProfileUpsertInput {
  legalType?: LegalType | null;
  fullName?: string;
  contractStartDate?: Date;
  contractDeadlineDate?: Date;
  phone?: string;
  email?: string;
  inn?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedAt?: Date;
  passportIssuedByInstrumental?: string;
  passportDepartmentCode?: string;
  registrationAddress?: string;
  ogrnip?: string;
  taxSystem?: string;
  bankAccount?: string;
  bankBik?: string;
  bankCorrAccount?: string;
  bankName?: string;
  profileCompleted?: boolean;
}

export class CreatorProfileRepository {
  async findByUserId(userId: string) {
    return prisma.creatorProfile.findUnique({
      where: { userId }
    });
  }

  async upsertProfile(userId: string, input: CreatorProfileUpsertInput) {
    return prisma.creatorProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...input
      },
      update: {
        ...input
      }
    });
  }

  async updateProfileFields(
    userId: string,
    input: Partial<CreatorProfileUpsertInput>
  ) {
    return prisma.creatorProfile.update({
      where: { userId },
      data: input
    });
  }

  async updateProfileFieldsWithAudit(input: {
    creatorUserId: string;
    actorUserId: string;
    field: string;
    data: Prisma.CreatorProfileUpdateInput;
    oldValue: string | null;
    newValue: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const updatedProfile = await tx.creatorProfile.update({
        where: { userId: input.creatorUserId },
        data: input.data
      });

      await tx.creatorProfileChangeLog.create({
        data: {
          creatorUserId: input.creatorUserId,
          actorUserId: input.actorUserId,
          field: input.field,
          oldValue: input.oldValue,
          newValue: input.newValue
        }
      });

      return updatedProfile;
    });
  }
}
