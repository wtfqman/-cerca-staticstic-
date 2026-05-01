import { Scenes } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import {
  profileChangeRequestDecisionKeyboard,
  profileChangeRequestFieldKeyboard
} from '../keyboards/inline.keyboards';
import { SCENE_IDS } from './scene-ids';
import {
  creatorProfileFieldLabels,
  type CreatorProfileEditableField
} from '../services/creator-profile.service';
import {
  formatCreatorProfileChangeRequestFields
} from '../services/creator-profile-change-request.service';
import { formatCreatorDisplayName } from '../utils/formatters';
import { formatUserError, logUserError } from '../utils/user-errors';

const buildTeamLeadRequestMessage = (
  request: Awaited<ReturnType<typeof container.services.creatorProfileChangeRequestService.createForCreator>>
) => {
  const fields = container.services.creatorProfileChangeRequestService.getRequestFields(request);

  return [
    'Запрос на изменение регистрационных данных',
    '',
    `Креатор: ${formatCreatorDisplayName(request.creator)}`,
    '',
    'Креатор просит изменить:',
    formatCreatorProfileChangeRequestFields(fields),
    '',
    'Подтверди запрос, если данные действительно нужно обновить. После подтверждения откроется редактирование только выбранных полей.'
  ].join('\n');
};

export const profileChangeRequestScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.profileChangeRequest,
  async (ctx) => {
    const currentUser = ctx.state.currentUser;

    if (!currentUser?.creatorProfile?.legalType) {
      await ctx.reply('Сначала нужно завершить анкету. После этого можно запросить изменение данных.');
      await ctx.scene.leave();
      return;
    }

    const fields = container.services.creatorProfileChangeRequestService.getAllowedFieldsForLegalType(
      currentUser.creatorProfile.legalType
    );

    if (!fields.length) {
      await ctx.reply('Сейчас нет доступных полей для запроса на изменение.');
      await ctx.scene.leave();
      return;
    }

    await ctx.reply(
      [
        'Самостоятельное изменение регистрационных данных отключено.',
        'Выбери, что нужно изменить. Я отправлю запрос твоему тимлиду.',
        '',
        'Доступны только согласованные поля.'
      ].join('\n'),
      profileChangeRequestFieldKeyboard(fields)
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      await ctx.reply('Выбери поле кнопкой ниже.');
      return;
    }

    if (ctx.callbackQuery.data === 'profile_change_request_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply('Запрос на изменение данных отменен.');
      await ctx.scene.leave();
      return;
    }

    if (!ctx.callbackQuery.data.startsWith('profile_change_request_field:')) {
      return;
    }

    const field = ctx.callbackQuery.data.split(':')[1] as CreatorProfileEditableField;
    const currentUser = ctx.state.currentUser;

    try {
      if (!currentUser) {
        throw new Error('Пользователь не найден.');
      }

      const request = await container.services.creatorProfileChangeRequestService.createForCreator(
        currentUser,
        [field]
      );
      const fields = container.services.creatorProfileChangeRequestService.getRequestFields(request);

      await ctx.answerCbQuery('Запрос отправлен');
      await ctx.reply(
        [
          'Я отправил запрос твоему тимлиду.',
          '',
          'Нужно изменить:',
          formatCreatorProfileChangeRequestFields(fields),
          '',
          'Когда тимлид подтвердит или отклонит запрос, я сообщу тебе здесь.'
        ].join('\n')
      );
      await ctx.telegram.sendMessage(
        request.teamLead.telegramId,
        buildTeamLeadRequestMessage(request),
        profileChangeRequestDecisionKeyboard(request.id)
      );
      await ctx.scene.leave();
    } catch (error) {
      logUserError(error, 'Creator profile change request failed', {
        userId: currentUser?.id,
        field
      });
      await ctx.answerCbQuery('Не удалось отправить запрос');
      await ctx.reply(
        formatUserError(
          error,
          `Сейчас не удалось отправить запрос на изменение поля "${creatorProfileFieldLabels[field]}". Попробуй еще раз.`
        )
      );
      await ctx.scene.leave();
    }
  }
);
