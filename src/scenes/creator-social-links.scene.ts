import { SocialPlatform } from '@prisma/client';
import { Scenes } from 'telegraf';

import { container } from '../container';
import { cancelSceneKeyboard, mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import type { BotContext } from '../types/bot-context';
import { getMessageText } from '../utils/telegram';
import { formatValidationError, logUserError } from '../utils/user-errors';
import {
  creatorSocialPlatformLabels,
  creatorSocialPlatformOrder
} from '../services/creator-social-account.service';
import { SCENE_IDS } from './scene-ids';

type CreatorSocialLinksState = {
  values?: Partial<Record<SocialPlatform, string>>;
};

const getState = (ctx: BotContext) => ctx.wizard.state as CreatorSocialLinksState;

const promptPlatform = async (ctx: BotContext, platform: SocialPlatform) => {
  await ctx.reply(
    [
      `Отправь ссылку или @username для ${creatorSocialPlatformLabels[platform]}.`,
      'Например: https://..., @username или username.'
    ].join('\n'),
    cancelSceneKeyboard()
  );
};

const saveValue = (ctx: BotContext, platform: SocialPlatform) => {
  const value = container.services.creatorSocialAccountService.validateHandleOrUrl(
    getMessageText(ctx.message)
  );
  const state = getState(ctx);
  state.values = {
    ...(state.values ?? {}),
    [platform]: value
  };
};

const requireCompleteValues = (values: Partial<Record<SocialPlatform, string>> | undefined) => {
  const missingPlatform = creatorSocialPlatformOrder.find((platform) => !values?.[platform]);

  if (missingPlatform) {
    throw new Error(`Не вижу ссылку для ${creatorSocialPlatformLabels[missingPlatform]}.`);
  }

  return values as Record<SocialPlatform, string>;
};

export const creatorSocialLinksScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.creatorSocialLinks,
  async (ctx) => {
    try {
      const accounts = await container.services.creatorSocialAccountService.listByCreatorUserId(
        ctx.state.currentUser!.id
      );
      getState(ctx).values = container.services.creatorSocialAccountService.mapAccountsToValues(accounts);

      await ctx.reply(
        [
          'Заполним ссылки на соцсети.',
          'Нужно пройти 4 шага: Instagram, TikTok, VK и YouTube.',
          '',
          'Сейчас сохранено:',
          container.services.creatorSocialAccountService.formatLinks(accounts)
        ].join('\n'),
        cancelSceneKeyboard()
      );
      await promptPlatform(ctx, SocialPlatform.INSTAGRAM);
      return ctx.wizard.next();
    } catch (error) {
      logUserError(error, 'Creator social links scene open failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply('Не удалось открыть заполнение соцсетей. Попробуй еще раз позже.');
      await ctx.scene.leave();
    }
  },
  async (ctx) => {
    try {
      saveValue(ctx, SocialPlatform.INSTAGRAM);
      await promptPlatform(ctx, SocialPlatform.TIKTOK);
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Пришли ссылку или username для Instagram.'));
    }
  },
  async (ctx) => {
    try {
      saveValue(ctx, SocialPlatform.TIKTOK);
      await promptPlatform(ctx, SocialPlatform.VK);
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Пришли ссылку или username для TikTok.'));
    }
  },
  async (ctx) => {
    try {
      saveValue(ctx, SocialPlatform.VK);
      await promptPlatform(ctx, SocialPlatform.YOUTUBE);
      return ctx.wizard.next();
    } catch (error) {
      await ctx.reply(formatValidationError(error, 'Пришли ссылку или username для VK.'));
    }
  },
  async (ctx) => {
    try {
      saveValue(ctx, SocialPlatform.YOUTUBE);
      const values = requireCompleteValues(getState(ctx).values);
      const accounts = await container.services.creatorSocialAccountService.saveAll(
        ctx.state.currentUser!.id,
        values
      );

      await ctx.reply(
        [
          'Ссылки сохранены.',
          '',
          container.services.creatorSocialAccountService.formatLinks(accounts)
        ].join('\n'),
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'Creator social links save failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(formatValidationError(error, 'Пришли ссылку или username для YouTube.'));
    }
  }
);
