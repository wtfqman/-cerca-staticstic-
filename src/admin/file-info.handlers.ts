import { UserRole } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import { roleGuard } from '../middlewares/role-guard.middleware';
import type { BotContext } from '../types/bot-context';

const emptyValue = '—';

const formatBytes = (value?: number) => {
  if (typeof value !== 'number') {
    return emptyValue;
  }

  return `${value.toLocaleString('ru-RU')} bytes`;
};

const formatDocumentFileInfo = (ctx: BotContext) => {
  if (!ctx.message || !('document' in ctx.message)) {
    return null;
  }

  const document = ctx.message.document;

  return [
    'File info',
    '',
    `message_id: ${ctx.message.message_id}`,
    'type: document',
    `file_id: ${document.file_id}`,
    `file_unique_id: ${document.file_unique_id}`,
    `file_name: ${document.file_name ?? emptyValue}`,
    `mime_type: ${document.mime_type ?? emptyValue}`,
    `size: ${formatBytes(document.file_size)}`
  ].join('\n');
};

const formatPhotoFileInfo = (ctx: BotContext) => {
  if (!ctx.message || !('photo' in ctx.message)) {
    return null;
  }

  const photos = ctx.message.photo;
  const largestPhoto = photos[photos.length - 1];

  if (!largestPhoto) {
    return null;
  }

  return [
    'File info',
    '',
    `message_id: ${ctx.message.message_id}`,
    'type: photo',
    `file_id: ${largestPhoto.file_id}`,
    `file_unique_id: ${largestPhoto.file_unique_id}`,
    `file_name: ${emptyValue}`,
    'mime_type: image/jpeg (telegram photo)',
    `size: ${formatBytes(largestPhoto.file_size)}`,
    `dimensions: ${largestPhoto.width}x${largestPhoto.height}`,
    '',
    'available_photo_sizes:',
    ...photos.map((photo, index) =>
      [
        `${index + 1}. ${photo.width}x${photo.height}`,
        `file_id=${photo.file_id}`,
        `file_unique_id=${photo.file_unique_id}`,
        `size=${formatBytes(photo.file_size)}`
      ].join(' | ')
    )
  ].join('\n');
};

const formatTelegramFileInfo = (ctx: BotContext) =>
  formatDocumentFileInfo(ctx) ?? formatPhotoFileInfo(ctx);

const handleAdminFileInfoMessage = async (ctx: BotContext, next: () => Promise<void>) => {
  if (ctx.state.currentUser?.role !== UserRole.ADMIN || !ctx.scene.session.adminFileInfoMode) {
    await next();
    return;
  }

  const info = formatTelegramFileInfo(ctx);

  if (!info) {
    await next();
    return;
  }

  ctx.scene.session.adminFileInfoMode = undefined;
  await ctx.reply(info);
};

export const registerAdminFileInfoHandlers = (bot: Telegraf<BotContext>) => {
  bot.command('fileinfo', roleGuard(UserRole.ADMIN), async (ctx) => {
    ctx.scene.session.adminFileInfoMode = true;

    await ctx.reply(
      [
        'Служебный режим fileinfo включен.',
        'Пришли следующим сообщением файл или фото, и я покажу file_id и технические поля Telegram.'
      ].join('\n')
    );
  });

  bot.on('document', handleAdminFileInfoMessage);
  bot.on('photo', handleAdminFileInfoMessage);
};
