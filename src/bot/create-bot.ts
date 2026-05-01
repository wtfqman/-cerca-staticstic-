import { UserRole } from '@prisma/client';
import { session, Telegraf } from 'telegraf';

import { container } from '../container';
import { PrismaSessionStore } from '../db/prisma-session-store';
import { registerAdminHandlers } from '../admin/admin.handlers';
import { registerAdminFileInfoHandlers } from '../admin/file-info.handlers';
import { createStage } from '../scenes';
import { registerCommands } from '../commands/register-commands';
import { currentUserMiddleware } from '../middlewares/current-user.middleware';
import { errorBoundaryMiddleware } from '../middlewares/error-boundary.middleware';
import { updateLoggingMiddleware } from '../middlewares/update-logging.middleware';
import type { BotContext } from '../types/bot-context';
import { config } from '../config';
import { registerAdminCreatorTestHandlers } from '../creators/admin-creator-test.handlers';
import { registerCreatorHandlers } from '../creators/creator.handlers';
import { registerDocumentHandlers } from '../documents/document.handlers';
import { registerTeamLeadHandlers } from '../teamleads/teamlead.handlers';
import {
  handleCancel,
  handleDocumentReplyUpload,
  handleHelp,
  handleWeeklyStatAttachments
} from '../handlers/common.handlers';
import { formatUserError, logUserError } from '../utils/user-errors';
import { roleGuard } from '../middlewares/role-guard.middleware';
import { canUseCreatorScenario } from '../utils/access';

export const createBot = () => {
  const bot = new Telegraf<BotContext>(config.bot.token);
  const stage = createStage();

  bot.use(errorBoundaryMiddleware);
  bot.use(updateLoggingMiddleware);
  bot.use(
    session({
      store: new PrismaSessionStore<any>(),
      getSessionKey: (ctx) => {
        if (!ctx.from || !ctx.chat) {
          return undefined;
        }

        return `${ctx.from.id}:${ctx.chat.id}`;
      }
    })
  );
  bot.use(currentUserMiddleware);
  bot.use(stage.middleware());
  bot.command('cancel', handleCancel);

  registerAdminFileInfoHandlers(bot);
  registerCommands(bot);
  registerAdminCreatorTestHandlers(bot);
  registerCreatorHandlers(bot);
  registerTeamLeadHandlers(bot);
  registerAdminHandlers(bot);
  registerDocumentHandlers(bot);

  bot.hears('Помощь', handleHelp);

  bot.action(/^daily_confirm:(.+)$/, async (ctx) => {
    if (!canUseCreatorScenario(ctx.state.currentUser)) {
      await ctx.answerCbQuery('Недоступно');
      await ctx.reply('Подтверждение выкладки доступно только креатору, которому было отправлено напоминание.');
      return;
    }

    try {
      await container.services.dailyCheckService.confirmCheck(ctx.state.currentUser.id, ctx.match[1]);
      await ctx.answerCbQuery('Подтверждение сохранено');
      await ctx.reply('Отлично, зафиксировал выкладку за сегодня.');
    } catch (error) {
      logUserError(error, 'Daily publication confirmation failed', {
        userId: ctx.state.currentUser?.id,
        checkId: ctx.match[1]
      });
      await ctx.answerCbQuery('Не удалось сохранить');
      await ctx.reply(
        formatUserError(error, 'Не удалось сохранить подтверждение. Открой свежее напоминание и попробуй еще раз.')
      );
    }
  });

  bot.action(/^daily_later:(.+)$/, async (ctx) => {
    if (!canUseCreatorScenario(ctx.state.currentUser)) {
      await ctx.answerCbQuery('Недоступно');
      await ctx.reply('Эта кнопка относится к ежедневному напоминанию креатора.');
      return;
    }

    await ctx.answerCbQuery('Хорошо, можно вернуться позже');
    await ctx.reply('Хорошо, сможешь подтвердить позже сегодня.');
  });

  bot.action(
    /^weekly_stat_attachments:(.+)$/,
    roleGuard(UserRole.ADMIN, UserRole.TEAMLEAD),
    async (ctx) => handleWeeklyStatAttachments(ctx, ctx.match[1])
  );

  bot.on('document', async (ctx, next) => {
    const handled = await handleDocumentReplyUpload(ctx);

    if (!handled) {
      await next();
    }
  });

  return bot;
};
