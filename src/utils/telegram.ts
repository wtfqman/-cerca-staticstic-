import type { Message } from 'telegraf/typings/core/types/typegram';

export const TELEGRAM_MESSAGE_SAFE_LIMIT = 3000;

export const getMessageText = (message?: Message): string => {
  if (message && 'text' in message) {
    return message.text.trim();
  }

  return '';
};

const getTelegramMessageSize = (text: string) => Buffer.byteLength(text, 'utf8');

export const splitTelegramMessage = (text: string, limit = TELEGRAM_MESSAGE_SAFE_LIMIT): string[] => {
  if (getTelegramMessageSize(text) <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  const pushLongLine = (line: string) => {
    let part = '';

    for (const char of Array.from(line)) {
      const next = `${part}${char}`;

      if (getTelegramMessageSize(next) > limit) {
        if (part) {
          chunks.push(part);
        }

        part = char;
        continue;
      }

      part = next;
    }

    if (part) {
      chunks.push(part);
    }
  };

  for (const line of text.split('\n')) {
    if (getTelegramMessageSize(line) > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      pushLongLine(line);
      continue;
    }

    const next = current ? `${current}\n${line}` : line;

    if (getTelegramMessageSize(next) > limit) {
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
