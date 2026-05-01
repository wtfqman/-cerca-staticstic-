import type { Telegram } from 'telegraf';
import { NotificationType } from '@prisma/client';

import { logger } from '../lib/logger';
import { NotificationRepository } from '../repositories/notification.repository';

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  async sendText(telegram: Telegram, userId: string, chatId: string | number, text: string, payload?: unknown) {
    const message = await telegram.sendMessage(chatId, text);
    await this.repository.create(userId, NotificationType.SYSTEM, payload ?? { text });
    return message;
  }

  async sendDocument(
    telegram: Telegram,
    userId: string,
    chatId: string | number,
    document: Parameters<Telegram['sendDocument']>[1],
    caption: string,
    payload?: unknown
  ) {
    const message = await telegram.sendDocument(chatId, document, {
      caption
    });
    await this.repository.create(userId, NotificationType.DOCUMENT_SENT, payload ?? { caption });
    return message;
  }

  async safeSend(
    operation: () => Promise<unknown>,
    contextMessage: string
  ) {
    try {
      return await operation();
    } catch (error) {
      logger.error({ error }, contextMessage);
      return null;
    }
  }
}
