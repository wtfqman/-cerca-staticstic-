import { NotificationType } from '@prisma/client';

import { prisma } from '../lib/prisma';

export class NotificationRepository {
  async create(userId: string, type: NotificationType, payloadJson?: unknown) {
    return prisma.notificationLog.create({
      data: {
        userId,
        type,
        payloadJson: payloadJson ? JSON.parse(JSON.stringify(payloadJson)) : undefined,
        sentAt: new Date()
      }
    });
  }
}
