import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

const paymentSnapshotWithCreatorInclude = Prisma.validator<Prisma.MonthlyPaymentSnapshotInclude>()({
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
});

export class PaymentSnapshotRepository {
  async upsert(
    creatorUserId: string,
    monthKey: string,
    payload: {
      rawViews: number;
      roundedViews: number;
      appliedRate: number;
      viewSteps: number;
      actualVideoCount: number;
      fixedSalaryPart: number;
      variablePart: number;
      totalPayment: number;
      payloadJson: unknown;
    }
  ) {
    return prisma.monthlyPaymentSnapshot.upsert({
      where: {
        creatorUserId_monthKey: {
          creatorUserId,
          monthKey
        }
      },
      create: {
        creatorUserId,
        monthKey,
        ...payload,
        payloadJson: JSON.parse(JSON.stringify(payload.payloadJson))
      },
      update: {
        ...payload,
        payloadJson: JSON.parse(JSON.stringify(payload.payloadJson))
      }
    });
  }

  async findByCreatorAndMonth(creatorUserId: string, monthKey: string) {
    return prisma.monthlyPaymentSnapshot.findUnique({
      where: {
        creatorUserId_monthKey: {
          creatorUserId,
          monthKey
        }
      }
    });
  }

  async listByMonth(monthKey: string) {
    return prisma.monthlyPaymentSnapshot.findMany({
      where: { monthKey },
      include: paymentSnapshotWithCreatorInclude,
      orderBy: { creatorUserId: 'asc' }
    });
  }

  async listAll() {
    return prisma.monthlyPaymentSnapshot.findMany({
      include: paymentSnapshotWithCreatorInclude,
      orderBy: [{ monthKey: 'asc' }, { creatorUserId: 'asc' }]
    });
  }
}
