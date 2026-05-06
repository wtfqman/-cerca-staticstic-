import { UserRole } from '@prisma/client';
import { Markup, type Telegraf } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { TEAMLEAD_MENU } from '../keyboards/menu-labels';
import { roleGuard } from '../middlewares/role-guard.middleware';
import {
  creatorProfileActionsKeyboard,
  entitySelectionKeyboard,
  reportMonthKeyboard,
  teamLeadGroupReviewKeyboard,
  weeklyReportReviewKeyboard
} from '../keyboards/inline.keyboards';
import { getCurrentMonthKey, getPreviousMonthKey, toDateKey } from '../utils/periods';
import {
  formatCreatorMonthlyReport,
  formatMissingDocuments,
  formatMissingWeeklyStats,
  formatTeamLeadAttentionSummary,
  formatTeamLeadGroupReport,
  formatWeeklyReviewActionResult
} from '../reports/report.formatters';
import { formatCreatorDisplayName } from '../utils/formatters';
import { SCENE_IDS } from '../scenes/scene-ids';
import { formatUserError, logUserError } from '../utils/user-errors';
import { canUseCreatorScenario } from '../utils/access';
import type { WeeklyReportReviewSummary } from '../types/report.types';

const findCreatorInTeamLeadGroup = async (teamLeadUserId: string, creatorUserId: string) => {
  const creators = await container.services.teamLeadReportService.listGroupCreators(teamLeadUserId);
  return creators.find((creator) => creator.id === creatorUserId) ?? null;
};

const reviewableWeeklyReportStatuses = new Set(['SUBMITTED', 'CONFIRMED']);

const getReviewableWeeklyReports = (reports: WeeklyReportReviewSummary[]) =>
  reports.filter((report) => reviewableWeeklyReportStatuses.has(report.status) && !report.isReviewedByTeamLead);

const formatCreatorProfileCard = async (teamLeadUserId: string, creatorUserId: string) => {
  const creator = await findCreatorInTeamLeadGroup(teamLeadUserId, creatorUserId);

  if (!creator) {
    return null;
  }

  const socialLinks = await container.services.creatorSocialAccountService.formatCreatorLinks(creatorUserId);

  return [
    `Креатор: ${formatCreatorDisplayName(creator)}`,
    '',
    container.services.creatorProfileService.formatProfileSummary(creator.creatorProfile),
    '',
    socialLinks
  ].join('\n');
};

const buildUnassignedCreatorItems = async () =>
  (await container.repositories.teamLeadRepository.listUnassignedCreators()).map((creator) => ({
    id: creator.id,
    label: formatCreatorDisplayName(creator)
  }));

const teamLeadGroupActionsKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('Добавить креатора', 'teamlead_group_assign_start')]]);

const replyEmptyGroup = async (ctx: BotContext) => {
  await ctx.reply(
    'В твоей группе пока нет креаторов. Если креатор уже открыл бота и получил доступ, его можно добавить кнопкой ниже.',
    teamLeadGroupActionsKeyboard()
  );
};

export const registerTeamLeadHandlers = (bot: Telegraf<BotContext>) => {
  bot.hears(TEAMLEAD_MENU.group, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    await ctx.reply(
      creators.length
        ? creators.map((creator) => `• ${formatCreatorDisplayName(creator)}`).join('\n')
        : 'В группе пока нет креаторов. Если креатор уже открыл бота и получил доступ, его можно добавить кнопкой ниже.',
      teamLeadGroupActionsKeyboard()
    );
  });

  bot.action('teamlead_group_assign_start', roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await buildUnassignedCreatorItems();
    await ctx.answerCbQuery();
    ctx.scene.session.teamLeadGroupAssignCreatorId = undefined;

    if (!creators.length) {
      await ctx.reply(
        [
          'Свободных креаторов для добавления сейчас нет.',
          '',
          'Креатор должен сначала открыть бота через /start и получить доступ креатора. Если он уже закреплен за другим тимлидом, переназначить его может только админ.'
        ].join('\n')
      );
      return;
    }

    await ctx.reply(
      'Выбери креатора, которого хочешь добавить в свою команду.',
      entitySelectionKeyboard('teamlead_group_assign_creator', creators)
    );
  });

  bot.action(/^teamlead_group_assign_creator:page:(\d+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const page = Number(ctx.match[1]!);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('teamlead_group_assign_creator', await buildUnassignedCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^teamlead_group_assign_creator:pick:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.match[1]!;
    const [creator, activeLink] = await Promise.all([
      container.services.userService.getById(creatorUserId),
      container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId)
    ]);
    await ctx.answerCbQuery();

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.reply('Креатор не найден или еще не зарегистрирован.');
      return;
    }

    if (activeLink) {
      await ctx.reply('Этот креатор уже прикреплен к тимлиду. Переназначать может только админ.');
      return;
    }

    ctx.scene.session.teamLeadGroupAssignCreatorId = creatorUserId;
    await ctx.reply(
      ['Добавить креатора в твою команду?', '', `Креатор: ${formatCreatorDisplayName(creator!)}`].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'teamlead_group_assign_confirm')],
        [Markup.button.callback('Отмена', 'teamlead_group_assign_cancel')]
      ])
    );
  });

  bot.action('teamlead_group_assign_cancel', roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    ctx.scene.session.teamLeadGroupAssignCreatorId = undefined;
    await ctx.answerCbQuery('Отменено');
    await ctx.reply('Добавление креатора отменено.');
  });

  bot.action('teamlead_group_assign_confirm', roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.scene.session.teamLeadGroupAssignCreatorId;
    await ctx.answerCbQuery('Добавляю...');

    if (!creatorUserId) {
      await ctx.reply('Не вижу выбранного креатора. Открой «Моя группа» и повтори добавление.');
      return;
    }

    const activeLink = await container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId!);

    if (activeLink) {
      ctx.scene.session.teamLeadGroupAssignCreatorId = undefined;
      await ctx.reply('Этот креатор уже прикреплен к тимлиду. Переназначать может только админ.');
      return;
    }

    const result = await container.repositories.teamLeadRepository.assignCreatorToTeamLead(
      creatorUserId!,
      ctx.state.currentUser!.id
    );
    ctx.scene.session.teamLeadGroupAssignCreatorId = undefined;

    await ctx.reply(
      ['Креатор добавлен в твою команду.', `Креатор: ${formatCreatorDisplayName(result.link.creator)}`].join('\n')
    );
  });

  bot.hears(TEAMLEAD_MENU.groupReport, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    await ctx.reply(
      'За какой месяц показать групповой отчет?',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), 'teamlead_group_report')
    );
  });

  bot.hears(TEAMLEAD_MENU.creatorReport, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    await ctx.reply(
      'Выбери креатора из своей группы.',
      entitySelectionKeyboard(
        'teamlead_creator_pick',
        creators.map((creator) => ({
          id: creator.id,
          label: formatCreatorDisplayName(creator)
        }))
      )
    );
  });

  bot.hears(TEAMLEAD_MENU.missedChecks, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    const pending = await container.services.teamLeadService.getMissingConfirmation(
      ctx.state.currentUser!.id,
      toDateKey(new Date())
    );

    if (!pending.length) {
      await ctx.reply('Сегодня все креаторы подтвердили выкладку.');
      return;
    }

    await ctx.reply(
      ['Не подтвердили выкладку:', ...pending.map((item) => `• ${item.creator.creatorProfile?.fullName ?? item.creator.telegramId}`)].join('\n')
    );
  });

  bot.hears(TEAMLEAD_MENU.missingStats, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    const missing = await container.services.teamLeadService.getMissingWeeklyStats(ctx.state.currentUser!.id);
    await ctx.reply(formatMissingWeeklyStats(missing));
  });

  bot.hears(TEAMLEAD_MENU.missingDocuments, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    await ctx.reply(
      'За какой месяц проверить документы по группе?',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), 'teamlead_missing_documents')
    );
  });

  bot.hears(TEAMLEAD_MENU.attention, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);

    if (!creators.length) {
      await replyEmptyGroup(ctx);
      return;
    }

    const summary = await container.services.teamLeadService.getAttentionSummary(
      ctx.state.currentUser!.id,
      getCurrentMonthKey()
    );
    await ctx.reply(formatTeamLeadAttentionSummary(summary));
  });

  bot.action(/^teamlead_group_report:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const monthKey = ctx.match[1];
    const report = await container.services.teamLeadReportService.getGroupReport(ctx.state.currentUser!.id, monthKey);
    const reviewableReports = getReviewableWeeklyReports(report.weeklyReports);
    const reviewKeyboard = teamLeadGroupReviewKeyboard(monthKey, reviewableReports.length);

    await ctx.answerCbQuery();
    await ctx.reply(formatTeamLeadGroupReport(report), reviewKeyboard);
  });

  bot.action(/^teamlead_creator_pick:page:(\d+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const page = Number(ctx.match[1]);
    const creators = await container.services.teamLeadReportService.listGroupCreators(ctx.state.currentUser!.id);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard(
        'teamlead_creator_pick',
        creators.map((creator) => ({
          id: creator.id,
          label: formatCreatorDisplayName(creator)
        })),
        page
      ).reply_markup
    );
  });

  bot.action(/^teamlead_creator_pick:pick:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const card = await formatCreatorProfileCard(ctx.state.currentUser!.id, creatorUserId);
    await ctx.answerCbQuery();

    if (!card) {
      await ctx.reply('У тебя нет доступа к этому креатору.');
      return;
    }

    await ctx.reply(
      card,
      creatorProfileActionsKeyboard({
        reportCallbackData: `teamlead_creator_report_menu:${creatorUserId}`,
        editCallbackData: `teamlead_creator_profile_edit:${creatorUserId}`
      })
    );
  });

  bot.action(/^teamlead_creator_report_menu:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await findCreatorInTeamLeadGroup(ctx.state.currentUser!.id, creatorUserId);
    await ctx.answerCbQuery();

    if (!creator) {
      await ctx.reply('У тебя нет доступа к этому креатору.');
      return;
    }

    await ctx.reply(
      'За какой месяц показать отчет по креатору?',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), `teamlead_creator_report:${creatorUserId}`)
    );
  });

  bot.action(/^teamlead_creator_report:(.+):(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const monthKey = ctx.match[2];
    await ctx.answerCbQuery();

    try {
      const report = await container.services.teamLeadReportService.getCreatorReport(
        ctx.state.currentUser!.id,
        creatorUserId,
        monthKey
      );
      const message = [
        `Креатор: ${formatCreatorDisplayName(report.creator)}`,
        '',
        formatCreatorMonthlyReport({
          creatorUserId,
          monthKey,
          label: monthKey,
          aggregation: report.aggregation,
          payment: report.payment,
          weeklyReports: report.weeklyReports
        })
      ].join('\n');
      const reviewKeyboard = weeklyReportReviewKeyboard(report.weeklyReports);

      if (reviewKeyboard) {
        await ctx.reply(message, reviewKeyboard);
        return;
      }

      await ctx.reply(message);
    } catch (error) {
      logUserError(error, 'Teamlead creator report open failed', {
        userId: ctx.state.currentUser?.id,
        creatorUserId,
        monthKey
      });
      await ctx.reply(
        formatUserError(error, 'Сейчас не удалось открыть отчет креатора. Попробуй еще раз.')
      );
    }
  });

  bot.action(/^teamlead_group_weekly_review:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const monthKey = ctx.match[1];
    await ctx.answerCbQuery('Сохраняю проверку...');

    try {
      const report = await container.services.teamLeadReportService.getGroupReport(
        ctx.state.currentUser!.id,
        monthKey
      );
      const reviewableReports = getReviewableWeeklyReports(report.weeklyReports);

      if (!reviewableReports.length) {
        await ctx.reply('Новых отправленных отчетов для проверки по группе нет.');
        return;
      }

      const results = await Promise.allSettled(
        reviewableReports.map((item) =>
          container.services.weeklyStatsService.markReportReviewedByTeamLead(
            item.reportId,
            ctx.state.currentUser!.id
          )
        )
      );
      const checked = results.filter((result) => result.status === 'fulfilled' && !result.value.alreadyReviewed)
        .length;
      const alreadyReviewed = results.filter(
        (result) => result.status === 'fulfilled' && result.value.alreadyReviewed
      ).length;
      const failed = results.filter((result) => result.status === 'rejected').length;

      await ctx.reply(
        [
          'Проверка статистики по группе сохранена.',
          `Месяц: ${monthKey}`,
          `Отмечено отчетов: ${checked}`,
          alreadyReviewed ? `Уже были проверены: ${alreadyReviewed}` : null,
          failed ? `Не удалось отметить: ${failed}` : null
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      logUserError(error, 'Teamlead group weekly report review failed', {
        userId: ctx.state.currentUser?.id,
        monthKey
      });
      await ctx.reply(
        formatUserError(error, 'Сейчас не удалось отметить статистику по группе проверенной. Попробуй еще раз.')
      );
    }
  });

  bot.action(/^teamlead_weekly_review:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const reportId = ctx.match[1];
    await ctx.answerCbQuery('Сохраняю проверку...');

    try {
      const result = await container.services.weeklyStatsService.markReportReviewedByTeamLead(
        reportId,
        ctx.state.currentUser!.id
      );
      await ctx.reply(formatWeeklyReviewActionResult(result.report, result.alreadyReviewed));
    } catch (error) {
      logUserError(error, 'Teamlead weekly report review failed', {
        userId: ctx.state.currentUser?.id,
        reportId
      });
      await ctx.reply(
        formatUserError(error, 'Сейчас не удалось отметить статистику проверенной. Попробуй еще раз.')
      );
    }
  });

  bot.action(/^teamlead_creator_profile_edit:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await findCreatorInTeamLeadGroup(ctx.state.currentUser!.id, creatorUserId);
    await ctx.answerCbQuery();

    if (!creator) {
      await ctx.reply('У тебя нет доступа к редактированию этого креатора.');
      return;
    }

    await ctx.reply(
      [
        'Самостоятельное редактирование креатора тимлидом теперь запускается через запрос креатора.',
        'Попроси креатора открыть "Мой профиль" и нажать "Запросить изменение данных".',
        'После подтверждения запроса я открою редактирование только выбранных полей.'
      ].join('\n')
    );
  });

  bot.action(/^profile_change_request_approve:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const requestId = ctx.match[1];

    try {
      const request = await container.services.creatorProfileChangeRequestService.approve(
        ctx.state.currentUser!,
        requestId
      );
      const fields = container.services.creatorProfileChangeRequestService.getRequestFields(request);

      await ctx.answerCbQuery('Запрос подтвержден');
      await ctx.telegram.sendMessage(
        request.creator.telegramId,
        [
          'Тимлид подтвердил запрос на изменение данных.',
          'После обновления я пришлю уведомление.'
        ].join('\n')
      );
      await ctx.reply('Запрос подтвержден. Сейчас открою редактирование выбранных полей.');
      await ctx.scene.enter(SCENE_IDS.profileEdit, {
        creatorUserId: request.creatorUserId,
        changeRequestId: request.id,
        allowedFields: fields
      });
    } catch (error) {
      logUserError(error, 'Profile change request approve failed', {
        userId: ctx.state.currentUser?.id,
        requestId
      });
      await ctx.answerCbQuery('Не удалось подтвердить');
      await ctx.reply(
        formatUserError(error, 'Сейчас не удалось подтвердить запрос на изменение данных. Попробуй еще раз.')
      );
    }
  });

  bot.action(/^profile_change_request_reject:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const requestId = ctx.match[1];

    try {
      const request = await container.services.creatorProfileChangeRequestService.reject(
        ctx.state.currentUser!,
        requestId
      );

      await ctx.answerCbQuery('Запрос отклонен');
      await ctx.telegram.sendMessage(
        request.creator.telegramId,
        'Тимлид отклонил запрос на изменение регистрационных данных.'
      );
      await ctx.reply('Запрос отклонен. Креатор получил уведомление.');
    } catch (error) {
      logUserError(error, 'Profile change request reject failed', {
        userId: ctx.state.currentUser?.id,
        requestId
      });
      await ctx.answerCbQuery('Не удалось отклонить');
      await ctx.reply(
        formatUserError(error, 'Сейчас не удалось отклонить запрос на изменение данных. Попробуй еще раз.')
      );
    }
  });

  bot.action(/^teamlead_missing_documents:(.+)$/, roleGuard(UserRole.TEAMLEAD), async (ctx) => {
    const monthKey = ctx.match[1];
    const missing = await container.services.teamLeadService.getMissingDocuments(ctx.state.currentUser!.id, monthKey);
    await ctx.answerCbQuery();
    await ctx.reply(formatMissingDocuments(missing, monthKey));
  });
};
