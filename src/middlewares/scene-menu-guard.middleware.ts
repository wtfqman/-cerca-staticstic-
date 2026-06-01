import { UserRole } from '@prisma/client';
import type { MiddlewareFn } from 'telegraf';

import { ADMIN_MENU, CREATOR_MENU, TEAMLEAD_MENU } from '../keyboards/menu-labels';
import { mainMenuKeyboardForUser, mainMenuTextForUser } from '../keyboards/menu.keyboards';
import type { BotContext } from '../types/bot-context';
import { getMessageText } from '../utils/telegram';
import {
  canUseAdminScenario,
  canUseCreatorScenario,
  canUseDocumentOperationsScenario,
  canUseTeamLeadScenario
} from '../utils/access';
import { SCENE_IDS } from '../scenes/scene-ids';

const commandInterruptions = new Set(['/cancel', '/help', '/menu', '/start']);

const menuTextsByRole: Record<UserRole, Set<string>> = {
  [UserRole.ADMIN]: new Set<string>(Object.values(ADMIN_MENU)),
  [UserRole.TEAMLEAD]: new Set<string>(Object.values(TEAMLEAD_MENU)),
  [UserRole.CREATOR]: new Set<string>(Object.values(CREATOR_MENU))
};

const allMenuTexts = new Set<string>([
  ...Object.values(ADMIN_MENU),
  ...Object.values(TEAMLEAD_MENU),
  ...Object.values(CREATOR_MENU)
]);

const documentOperationsMenuTexts = new Set<string>([
  ADMIN_MENU.documents,
  ADMIN_MENU.bulkActions
]);

const sceneCallbackPrefixes: Record<string, string[]> = {
  [SCENE_IDS.creatorRegistration]: ['register_'],
  [SCENE_IDS.profileEdit]: ['profile_edit_'],
  [SCENE_IDS.profileChangeRequest]: ['profile_change_request_'],
  [SCENE_IDS.weeklyStats]: ['weekly_'],
  [SCENE_IDS.monthlyVideo]: ['monthly_video_'],
  [SCENE_IDS.monthlyVideoMarchApril]: ['monthly_video_backfill_'],
  [SCENE_IDS.monthlyReachMarchApril]: ['monthly_reach_backfill_'],
  [SCENE_IDS.signedDocumentUpload]: ['document_upload_pick:'],
  [SCENE_IDS.paymentDocumentUpload]: ['payment_invoice_month:', 'payment_receipt_month:']
};

const normalizeCommand = (text: string) => {
  if (!text.startsWith('/')) {
    return null;
  }

  return text.split(/\s+/)[0].split('@')[0].toLowerCase();
};

const getInterruptionCommand = (ctx: BotContext) => {
  const text = getMessageText(ctx.message);

  if (!text) {
    return null;
  }

  const command = normalizeCommand(text);
  return command && commandInterruptions.has(command) ? command : null;
};

const getCallbackData = (ctx: BotContext) =>
  ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : null;

const isSceneCallback = (sceneId: string, data: string) =>
  sceneCallbackPrefixes[sceneId]?.some((prefix) => data.startsWith(prefix)) ?? false;

const isMenuTextInterruption = (ctx: BotContext) => {
  const text = getMessageText(ctx.message);

  if (!text || normalizeCommand(text)) {
    return false;
  }

  const currentUser = ctx.state.currentUser;

  if (currentUser) {
    return (
      (canUseAdminScenario(currentUser) && menuTextsByRole[UserRole.ADMIN].has(text)) ||
      (canUseDocumentOperationsScenario(currentUser) && documentOperationsMenuTexts.has(text)) ||
      (canUseTeamLeadScenario(currentUser) && menuTextsByRole[UserRole.TEAMLEAD].has(text)) ||
      (canUseCreatorScenario(currentUser) && menuTextsByRole[UserRole.CREATOR].has(text))
    );
  }

  return allMenuTexts.has(text);
};

export const sceneMenuGuardMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.scene.current) {
    return next();
  }

  const currentSceneId = ctx.scene.current.id;
  const command = getInterruptionCommand(ctx);

  if (command) {
    await ctx.scene.leave();

    if (command === '/cancel') {
      await ctx.reply(
        ['Текущее заполнение остановлено.', 'Вернул тебя в главное меню.'].join('\n'),
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      return;
    }

    return next();
  }

  const callbackData = getCallbackData(ctx);

  if (callbackData && !isSceneCallback(currentSceneId, callbackData)) {
    await ctx.scene.leave();
    return next();
  }

  if (!isMenuTextInterruption(ctx)) {
    return next();
  }

  await ctx.scene.leave();

  const keyboard = mainMenuKeyboardForUser(ctx.state.currentUser);

  if (!keyboard) {
    await ctx.reply('Текущее заполнение остановлено.');
    return;
  }

  await ctx.reply(
    [
      'Ты вышел из текущего заполнения.',
      'Чтобы начать заново, открой нужный раздел еще раз.',
      mainMenuTextForUser(ctx.state.currentUser)
    ].join('\n'),
    keyboard
  );
};
