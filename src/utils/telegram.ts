import type { Message } from 'telegraf/typings/core/types/typegram';

export const getMessageText = (message?: Message): string => {
  if (message && 'text' in message) {
    return message.text.trim();
  }

  return '';
};
