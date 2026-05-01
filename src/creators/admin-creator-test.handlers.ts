import { UserRole } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import { container } from '../container';
import { showMainMenu } from '../handlers/common.handlers';
import { ADMIN_MENU } from '../keyboards/menu-labels';
import { adminCreatorTestMenuKeyboard } from '../keyboards/menu.keyboards';
import { roleGuard } from '../middlewares/role-guard.middleware';
import type { BotContext } from '../types/bot-context';
import {
  ensureCreatorProfileCompletedForDocuments,
  openCreatorFirstQueueEntryFlow
} from './creator-documents.flow';

const ADMIN_CREATOR_TEST_READY_TEXT = [
  'Режим тестового креатора открыт.',
  'Права ADMIN сохранены. Команда /menu всегда вернет полное админское меню.',
  'Выбирай разделы ниже, чтобы пройти личные сценарии креатора.'
].join('\n');

const ADMIN_CREATOR_TEST_REGISTRATION_TEXT = [
  'Права ADMIN сохранены.',
  'Сейчас открою анкету тестового креатора. Команды /menu и /cancel вернут тебя в админское меню.'
].join('\n');

export const registerAdminCreatorTestHandlers = (bot: Telegraf<BotContext>) => {
  bot.hears(ADMIN_MENU.creatorTest, roleGuard(UserRole.ADMIN), async (ctx) => {
    const user = await container.services.userService.grantCreatorAccess(ctx.state.currentUser!.id);
    ctx.state.currentUser = user;

    if (!user.creatorProfile?.profileCompleted) {
      await ctx.reply(ADMIN_CREATOR_TEST_REGISTRATION_TEXT);
    }

    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await ctx.reply(ADMIN_CREATOR_TEST_READY_TEXT, adminCreatorTestMenuKeyboard(user));
    await openCreatorFirstQueueEntryFlow(ctx, { showMenu: false });
  });

  bot.hears(ADMIN_MENU.adminMenu, roleGuard(UserRole.ADMIN), showMainMenu);
};
