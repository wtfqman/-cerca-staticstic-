import type { Telegram } from 'telegraf';
import { NotificationType } from '@prisma/client';

import { logger } from '../lib/logger';
import { NotificationRepository } from '../repositories/notification.repository';

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  async sendText(
    telegram: Telegram,
    userId: string,
    chatId: string | number,
    text: string,
    payload?: unknown,
    extra?: Parameters<Telegram['sendMessage']>[2]
  ) {
    const message = await telegram.sendMessage(chatId, text, extra);
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

  async sendMediaGroup(
    telegram: Telegram,
    userId: string,
    chatId: string | number,
    media: Parameters<Telegram['sendMediaGroup']>[1],
    payloads: unknown[]
  ) {
    const messages = await telegram.sendMediaGroup(chatId, media);
    await Promise.all(
      payloads.map((payload) => this.repository.create(userId, NotificationType.DOCUMENT_SENT, payload))
    );
    return messages;
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
