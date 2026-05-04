import type { Message } from 'telegraf/typings/core/types/typegram';

export const TELEGRAM_MESSAGE_SAFE_LIMIT = 3900;

export const getMessageText = (message?: Message): string => {
  if (message && 'text' in message) {
    return message.text.trim();
  }

  return '';
};

export const splitTelegramMessage = (text: string, limit = TELEGRAM_MESSAGE_SAFE_LIMIT): string[] => {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  const pushLongLine = (line: string) => {
    for (let index = 0; index < line.length; index += limit) {
      chunks.push(line.slice(index, index + limit));
    }
  };

  for (const line of text.split('\n')) {
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      pushLongLine(line);
      continue;
    }

    const next = current ? `${current}\n${line}` : line;

    if (next.length > limit) {
      if (current) {
        chunks.push(current);
      }

      current = line;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};
