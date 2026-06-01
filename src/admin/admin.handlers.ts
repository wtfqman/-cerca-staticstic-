import { PaymentDocumentType, UserRole } from '@prisma/client';
import { Markup, type Telegraf } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import {
  adminBulkActionsKeyboard,
  adminCreatorLookupKeyboard,
  adminCreatorsActionsKeyboard,
  adminMissingMonthlyVideosKeyboard,
  adminStatsMonthKeyboard,
  adminGroupActionsKeyboard,
  approvalInlineKeyboard,
  creatorProfileActionsKeyboard,
  entitySelectionKeyboard,
  googleSheetsMenuKeyboard,
  googleSheetsRebuildKeyboard,
  reportMonthKeyboard,
  weeklyReportReviewKeyboard
} from '../keyboards/inline.keyboards';
import { ADMIN_MENU } from '../keyboards/menu-labels';
import { documentOperationsGuard, roleGuard } from '../middlewares/role-guard.middleware';
import {
  formatAdminAttentionSummary,
  formatAdminDashboardSummary,
  formatAdminPaymentsReport,
  formatAdminReport,
  formatBulkOperationResult,
  formatCreatorMonthlyReport,
  formatMissingDocuments,
  formatMissingMonthlyVideos,
  formatMissingWeeklyStats,
  formatTeamLeadGroupReport
} from '../reports/report.formatters';
import {
  formatCreatorDisplayName,
  formatFullName,
  formatIntegerRu,
  formatTeamLeadDisplayName
} from '../utils/formatters';
import { getCurrentMonthKey, getPreviousMonthKey } from '../utils/periods';
import { getMessageText, splitTelegramMessage } from '../utils/telegram';
import { SCENE_IDS } from '../scenes/scene-ids';
import {
  formatActiveRosterFirstQueueStatus,
  formatActiveRosterSecondQueueStatus,
  formatDocumentStatusLine
} from '../documents/document.formatters';
import { getCreatorInvoiceMonthKey } from '../documents/document-workflow.constants';
import { config } from '../config';
import { formatUserError, logUserError } from '../utils/user-errors';
import { canUseAdminScenario, canUseCreatorScenario, canUseTeamLeadScenario } from '../utils/access';
import type { AppUser } from '../types/domain';

const formatSheetSyncMessage = (result: {
  sheetName: string;
  inserted: number;
  updated: number;
  totalRows: number;
}) =>
  [
    `Лист: ${result.sheetName}`,
    `Добавлено строк: ${formatIntegerRu(result.inserted)}`,
    `Обновлено строк: ${formatIntegerRu(result.updated)}`,
    `Всего обработано: ${formatIntegerRu(result.totalRows)}`
  ].join('\n');

const formatGoogleSheetsConnectionMessage = (info: {
  spreadsheetId: string;
  title: string;
  sheets: string[];
}) => {
  const botSheetNames = Object.values(config.googleSheets.sheetNames);
  const availableSheetNames = new Set(info.sheets);
  const extraSheetNames = info.sheets.filter((sheetName) => !botSheetNames.includes(sheetName));

  return [
    'Google Sheets подключены',
    '',
    `Таблица: ${info.title}`,
    `ID: ${info.spreadsheetId}`,
    '',
    'Рабочие листы бота:',
    ...botSheetNames.map(
      (sheetName) => `- ${sheetName}: ${availableSheetNames.has(sheetName) ? 'готов' : 'не найден'}`
    ),
    ...(extraSheetNames.length ? ['', `Дополнительные листы: ${extraSheetNames.join(', ')}`] : []),
    '',
    'Можно запускать синхронизацию статистики, выплат и документов.'
  ].join('\n');
};

const logGoogleSheetsAdminError = (
  error: unknown,
  context: Record<string, unknown>
) => {
  logUserError(error, 'Admin Google Sheets action failed', context);
};

const answerCallbackQuerySafely = async (ctx: BotContext, text?: string) => {
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    logUserError(error, 'Failed to answer callback query', {
      updateId: ctx.update.update_id,
      callbackQueryId: ctx.callbackQuery?.id,
      action: 'answerCbQuery'
    });
  }
};

const formatServiceOverview = (
  overview: Awaited<ReturnType<typeof container.services.adminService.getOverview>>
) => {
  const creators = overview.creators
    .map((creator) => formatCreatorDisplayName(creator))
    .sort((left, right) => left.localeCompare(right, 'ru'));

  return [
    'Служебная сводка',
    '',
    `Админов: ${formatIntegerRu(overview.roleCounts.admins)}`,
    `Тимлидов: ${formatIntegerRu(overview.roleCounts.teamLeads)}`,
    `Креаторов: ${formatIntegerRu(creators.length)}`,
    `Активных связок в группах: ${formatIntegerRu(overview.activeGroupLinks)}`,
    `Документов всего: ${formatIntegerRu(overview.documents.total)}`,
    `Сгенерировано: ${formatIntegerRu(overview.documents.generated)}`,
    `Отправлено креаторам: ${formatIntegerRu(overview.documents.sent)}`,
    `Подписано или переслано: ${formatIntegerRu(overview.documents.signed)}`,
    `Google Sheets: ${container.services.googleSheetsSyncService.isEnabled() ? 'включены' : 'отключены'}`,
    '',
    `ФИО креаторов (${formatIntegerRu(creators.length)}):`,
    ...(creators.length ? creators.map((creator, index) => `${index + 1}. ${creator}`) : ['нет активных креаторов'])
  ].join('\n');
};

const buildCreatorItems = async () =>
  (await container.services.userService.listCreators()).map((creator) => ({
    id: creator.id,
    label: formatCreatorDisplayName(creator)
  }));

const buildPendingAccessItems = async () =>
  (await container.services.userService.listPendingAccess()).map((user) => ({
    id: user.id,
    label: formatFullName(user.firstName, user.lastName, user.username ? `@${user.username}` : user.telegramId)
  }));

const buildInactiveCreatorItems = async () =>
  (await container.services.userService.listInactiveCreators()).map((creator) => ({
    id: creator.id,
    label: formatCreatorDisplayName(creator)
  }));

const buildRevokableCreatorItems = async () =>
  (await container.services.userService.listRevokableCreators()).map((creator) => ({
    id: creator.id,
    label: formatCreatorDisplayName(creator)
  }));

type AdminCreatorLookupPurpose = 'profile' | 'revoke' | 'restore';
type AdminCreatorLookupMode = 'telegramId' | 'username';

const adminCreatorLookupListPrefixes: Record<AdminCreatorLookupPurpose, string> = {
  profile: 'admin_creator_pick',
  revoke: 'admin_creator_access_revoke',
  restore: 'admin_creator_access_restore'
};

const adminCreatorLookupPrompts: Record<AdminCreatorLookupPurpose, string> = {
  profile: 'Как найти креатора?',
  revoke: 'Как найти креатора для блокировки?',
  restore: 'Как найти креатора для возврата доступа?'
};

const adminCreatorLookupEmptyMessages: Record<AdminCreatorLookupPurpose, string> = {
  profile: 'Креаторов пока нет.',
  revoke: 'Активных креаторов для запрета доступа сейчас нет.',
  restore: 'Отключенных креаторов для возврата доступа сейчас нет.'
};

const adminCreatorLookupInputPrompts: Record<AdminCreatorLookupMode, string> = {
  telegramId: 'Пришли Telegram ID креатора.',
  username: 'Пришли username креатора, можно с @ или ссылкой t.me.'
};

const clearAdminCreatorLookupSession = (ctx: BotContext) => {
  ctx.scene.session.adminCreatorLookupPurpose = undefined;
  ctx.scene.session.adminCreatorLookupMode = undefined;
};

const normalizeTelegramIdInput = (input: string) => input.trim().replace(/[^\d]/g, '');

const normalizeUsernameInput = (input: string) => {
  const trimmed = input.trim();
  const withoutTelegramUrl = trimmed
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^https?:\/\/telegram\.me\//i, '')
    .replace(/^tg:\/\/resolve\?domain=/i, '');

  return withoutTelegramUrl
    .split(/[/?#\s]/)[0]
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
};

const buildCreatorLookupItems = async (purpose: AdminCreatorLookupPurpose) => {
  if (purpose === 'revoke') {
    return buildRevokableCreatorItems();
  }

  if (purpose === 'restore') {
    return buildInactiveCreatorItems();
  }

  return buildCreatorItems();
};

const listCreatorLookupUsers = async (purpose: AdminCreatorLookupPurpose) => {
  if (purpose === 'revoke') {
    return container.services.userService.listRevokableCreators();
  }

  if (purpose === 'restore') {
    return container.services.userService.listInactiveCreators();
  }

  return container.services.userService.listCreators();
};

const isCreatorValidForLookupPurpose = (purpose: AdminCreatorLookupPurpose, user: AppUser | null | undefined) => {
  if (!user) {
    return false;
  }

  if (purpose === 'revoke') {
    return canUseCreatorScenario(user) && user.role === UserRole.CREATOR;
  }

  if (purpose === 'restore') {
    return !user.isActive && (user.role === UserRole.CREATOR || Boolean(user.creatorProfile));
  }

  return canUseCreatorScenario(user);
};

const findCreatorByAdminLookup = async (
  purpose: AdminCreatorLookupPurpose,
  mode: AdminCreatorLookupMode,
  input: string
) => {
  if (mode === 'telegramId') {
    const telegramId = normalizeTelegramIdInput(input);

    if (!telegramId) {
      return null;
    }

    const user = await container.services.userService.getByTelegramId(telegramId);
    return isCreatorValidForLookupPurpose(purpose, user) ? user : null;
  }

  const username = normalizeUsernameInput(input);

  if (!username) {
    return null;
  }

  const creators = await listCreatorLookupUsers(purpose);
  return (
    creators.find((creator) => creator.username?.trim().toLowerCase() === username) ?? null
  );
};

const replyAdminCreatorLookupMenu = async (ctx: BotContext, purpose: AdminCreatorLookupPurpose) => {
  clearAdminCreatorLookupSession(ctx);

  if (!(await buildCreatorLookupItems(purpose)).length) {
    await ctx.reply(adminCreatorLookupEmptyMessages[purpose]);
    return;
  }

  await ctx.reply(adminCreatorLookupPrompts[purpose], adminCreatorLookupKeyboard(purpose));
};

const replyAdminCreatorLookupList = async (ctx: BotContext, purpose: AdminCreatorLookupPurpose) => {
  const items = await buildCreatorLookupItems(purpose);

  if (!items.length) {
    await ctx.reply(adminCreatorLookupEmptyMessages[purpose]);
    return;
  }

  await ctx.reply('Выбери креатора.', entitySelectionKeyboard(adminCreatorLookupListPrefixes[purpose], items));
};

const buildTeamLeadItems = async () =>
  (await container.services.userService.listTeamLeads()).map((lead) => ({
    id: lead.id,
    label: formatTeamLeadDisplayName(lead)
  }));

const replyAdminStatsTeamSelection = async (ctx: BotContext, monthKey: string, page = 0) => {
  const teamLeads = await buildTeamLeadItems();

  if (!teamLeads.length) {
    await ctx.reply('Тимлидов пока нет, поэтому отчет по командам показать не из чего.');
    return;
  }

  await ctx.reply(
    `Выбери команду для отчета за ${monthKey}.`,
    entitySelectionKeyboard(`admin_stats_team:${monthKey}`, teamLeads, page)
  );
};

const formatActiveGroups = (
  groups: Awaited<ReturnType<typeof container.repositories.teamLeadRepository.listGroups>>
) =>
  groups.length
    ? [
        'Активные связки креатор -> тимлид:',
        '',
        ...groups.map(
          (link) => `• ${formatCreatorDisplayName(link.creator)} -> ${formatTeamLeadDisplayName(link.teamLead)}`
        )
      ].join('\n')
    : [
        'Активных связок пока нет.',
        'Назначь креатора тимлиду, чтобы он появился в группе тимлида.'
      ].join('\n');

const formatCreatorProfileCard = async (creatorUserId: string) => {
  const creator = await container.services.userService.getById(creatorUserId);

  if (!creator || !canUseCreatorScenario(creator)) {
    return null;
  }

  const activeLink = await container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId);
  const socialLinks = await container.services.creatorSocialAccountService.formatCreatorLinks(creatorUserId);

  return [
    `Креатор: ${formatCreatorDisplayName(creator)}`,
    `Тимлид: ${activeLink ? formatTeamLeadDisplayName(activeLink.teamLead) : 'не назначен'}`,
    '',
    container.services.creatorProfileService.formatProfileSummary(creator.creatorProfile),
    '',
    socialLinks
  ].join('\n');
};

const replyCreatorProfileCard = async (ctx: BotContext, creatorUserId: string) => {
  const card = await formatCreatorProfileCard(creatorUserId);

  if (!card) {
    await ctx.reply('Креатор не найден. Открой раздел "Креаторы" и попробуй другой способ поиска.');
    return;
  }

  await ctx.reply(
    card,
    creatorProfileActionsKeyboard({
      reportCallbackData: `admin_creator_report_menu:${creatorUserId}`,
      editCallbackData: `admin_creator_profile_edit:${creatorUserId}`,
      assignTeamLeadCallbackData: `admin_group_assign_creator:pick:${creatorUserId}`
    })
  );
};

const replyCreatorAccessRevokeConfirmation = async (ctx: BotContext, userId: string) => {
  const user = await container.services.userService.getById(userId);

  if (!user || !canUseCreatorScenario(user) || user.role !== UserRole.CREATOR) {
    await ctx.reply('Креатор не найден или доступ уже не активен.');
    return;
  }

  await ctx.reply(
    ['Запретить доступ креатора?', '', `Креатор: ${formatCreatorDisplayName(user)}`].join('\n'),
    approvalInlineKeyboard(`admin_creator_access_revoke_confirm:${user.id}`)
  );
};

const replyCreatorAccessRestoreConfirmation = async (ctx: BotContext, userId: string) => {
  const user = await container.services.userService.getById(userId);

  if (!user || user.isActive) {
    await ctx.reply('Креатор не найден или доступ уже активен.');
    return;
  }

  await ctx.reply(
    ['Вернуть доступ креатора?', '', `Креатор: ${formatCreatorDisplayName(user)}`].join('\n'),
    approvalInlineKeyboard(`admin_creator_access_restore_confirm:${user.id}`)
  );
};

const replyAdminCreatorLookupResult = async (
  ctx: BotContext,
  purpose: AdminCreatorLookupPurpose,
  creatorUserId: string
) => {
  if (purpose === 'revoke') {
    await replyCreatorAccessRevokeConfirmation(ctx, creatorUserId);
    return;
  }

  if (purpose === 'restore') {
    await replyCreatorAccessRestoreConfirmation(ctx, creatorUserId);
    return;
  }

  await replyCreatorProfileCard(ctx, creatorUserId);
};

const knownBulkActions = new Set([
  'remind_weekly_stats',
  'remind_monthly_videos',
  'remind_documents',
  'generate_first_queue',
  'generate_second_queue',
  'await_receipts',
  'generate_documents',
  'sync_payments',
  'sync_documents'
]);

export const registerAdminHandlers = (bot: Telegraf<BotContext>) => {
  bot.hears(ADMIN_MENU.creators, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildCreatorItems();

    if (!creators.length) {
      await ctx.reply(
        [
          'Креаторов пока нет.',
          'Попроси тестового креатора открыть /start, затем выдай ему доступ креатора кнопкой ниже.'
        ].join('\n'),
        adminCreatorsActionsKeyboard()
      );
      return;
    }

    clearAdminCreatorLookupSession(ctx);
    await ctx.reply('Как найти креатора?', adminCreatorLookupKeyboard('profile'));
    await ctx.reply(
      'Если нужно подключить нового тестового креатора, сначала он должен открыть /start, затем выдай ему доступ здесь.',
      adminCreatorsActionsKeyboard()
    );
  });

  bot.hears(ADMIN_MENU.teamLeads, roleGuard(UserRole.ADMIN), async (ctx) => {
    const teamLeads = await buildTeamLeadItems();

    if (!teamLeads.length) {
      await ctx.reply(
        'Тимлидов пока нет. Добавь их seed/bootstrap-скриптом или назначь роль в базе перед ручной проверкой.'
      );
      return;
    }

    await ctx.reply('Выбери тимлида.', entitySelectionKeyboard('admin_teamlead_pick', teamLeads));
  });

  bot.hears(ADMIN_MENU.groups, roleGuard(UserRole.ADMIN), async (ctx) => {
    const groups = await container.repositories.teamLeadRepository.listGroups();
    await ctx.reply(formatActiveGroups(groups), adminGroupActionsKeyboard());
  });

  bot.hears(ADMIN_MENU.socialLinks, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await container.services.userService.listCreators();
    const chunks = await container.services.creatorSocialAccountService.formatCreatorsLinksListChunks(creators, {
      title: 'Соцсети всех креаторов',
      includeTeamLead: true
    });

    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  });

  bot.hears(ADMIN_MENU.stats, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildCreatorItems();

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет, поэтому статистику показать не из чего. После выдачи роли креатору и заполнения отчетов здесь появится сводка.'
      );
      return;
    }

    await ctx.reply(
      'Выбери отчет: общая сводка или отдельная команда.',
      adminStatsMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey())
    );
  });

  bot.hears(ADMIN_MENU.payments, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildCreatorItems();

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет, поэтому выплат пока нет. После регистрации креатора и внесения статистики раздел начнет заполняться.'
      );
      return;
    }

    await ctx.reply(
      'За какой месяц показать сводку по выплатам?',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), 'admin_payments')
    );
  });

  bot.hears(ADMIN_MENU.documents, documentOperationsGuard(), async (ctx) => {
    const creators = await buildCreatorItems();

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет, поэтому статусы документов показать не из чего. Сначала выдай доступ тестовому креатору и попроси его пройти регистрацию.'
      );
      return;
    }

    await ctx.reply(
      [
        'Новые PDF можно выгрузить в рабочий чат вручную.',
        'Договоры/NDA выгружаются отдельно. Счета выгружаются комплектом: счет, задание и акт за тот же месяц.',
        'Бот отправит только файлы, которые еще не выгружались.'
      ].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('Выгрузить документы', 'admin_export_new_signed_documents')],
        [Markup.button.callback('Выгрузить все документы заново', 'admin_export_all_signed_documents')],
        [Markup.button.callback('Выгрузить счета + акты/задания', 'admin_export_new_payment_documents:INVOICE')],
        [Markup.button.callback('Выгрузить чеки', 'admin_export_new_payment_documents:RECEIPT')],
        [Markup.button.callback('Выгрузить все счета + акты/задания заново', 'admin_export_all_payment_documents:INVOICE')],
        [Markup.button.callback('Выгрузить все чеки заново', 'admin_export_all_payment_documents:RECEIPT')]
      ])
    );

    await ctx.reply(
      'Выбери креатора, чтобы посмотреть документы и статусы.',
      entitySelectionKeyboard('admin_creator_documents_pick', creators)
    );
  });

  bot.hears(ADMIN_MENU.googleSheets, roleGuard(UserRole.ADMIN), async (ctx) => {
    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.reply(
        [
          'Google Sheets сейчас не подключены.',
          'Для ручной проверки это нормальное пустое состояние. Чтобы включить синхронизацию, задай GOOGLE_SHEETS_SYNC_ENABLED=true и настройки таблицы в .env.'
        ].join('\n')
      );
      return;
    }

    await ctx.reply('Управление синхронизацией Google Sheets.', googleSheetsMenuKeyboard());
  });

  bot.hears(ADMIN_MENU.bulkActions, documentOperationsGuard(), async (ctx) => {
    const creators = await buildCreatorItems();

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет. Массовые действия станут полезны после выдачи роли хотя бы одному креатору.'
      );
      return;
    }

    await ctx.reply('Выбери массовое действие.', adminBulkActionsKeyboard());
  });

  bot.hears(ADMIN_MENU.service, roleGuard(UserRole.ADMIN), async (ctx) => {
    const text = formatServiceOverview(await container.services.adminService.getOverview());

    for (const chunk of splitTelegramMessage(text)) {
      await ctx.reply(chunk);
    }
  });

  bot.hears(ADMIN_MENU.attention, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await container.services.userService.listCreators();
    const summary = await container.services.teamLeadService.getAttentionSummaryForCreators(
      creators,
      getCurrentMonthKey(),
      ctx.state.currentUser?.id ?? 'admin'
    );

    for (const chunk of splitTelegramMessage(formatAdminAttentionSummary(summary))) {
      await ctx.reply(chunk);
    }
  });

  bot.action(
    /^admin_creator_lookup:(profile|revoke|restore):(telegram_id|username|list|back)$/,
    roleGuard(UserRole.ADMIN),
    async (ctx) => {
      const purpose = ctx.match[1] as AdminCreatorLookupPurpose;
      const action = ctx.match[2];
      await ctx.answerCbQuery();

      if (action === 'back') {
        clearAdminCreatorLookupSession(ctx);
        await ctx.reply('Ок, вернулась назад. Можно выбрать другой раздел через меню.');
        return;
      }

      if (action === 'list') {
        clearAdminCreatorLookupSession(ctx);
        await replyAdminCreatorLookupList(ctx, purpose);
        return;
      }

      ctx.scene.session.adminCreatorLookupPurpose = purpose;
      ctx.scene.session.adminCreatorLookupMode = action === 'telegram_id' ? 'telegramId' : 'username';

      await ctx.reply(adminCreatorLookupInputPrompts[ctx.scene.session.adminCreatorLookupMode]);
    }
  );

  bot.action('admin_group_assign_start', roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildCreatorItems();
    await ctx.answerCbQuery();
    ctx.scene.session.adminGroupAssignCreatorId = undefined;
    ctx.scene.session.adminGroupAssignTeamLeadId = undefined;

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет. Сначала тестовый креатор должен открыть /start, получить доступ и пройти регистрацию.'
      );
      return;
    }

    await ctx.reply(
      'Шаг 1/3. Выбери креатора, которого нужно прикрепить к тимлиду.',
      entitySelectionKeyboard('admin_group_assign_creator', creators)
    );
  });

  bot.action(/^admin_group_assign_creator:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_group_assign_creator', await buildCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^admin_group_assign_creator:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await container.services.userService.getById(creatorUserId);
    const teamLeads = await buildTeamLeadItems();
    await ctx.answerCbQuery();

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.reply('Креатор не найден. Открой раздел "Группы" и начни назначение заново.');
      return;
    }

    if (!teamLeads.length) {
      await ctx.reply('Тимлидов пока нет. Сначала добавь тимлида, затем вернись в раздел "Группы".');
      return;
    }

    const activeLink = await container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId);
    ctx.scene.session.adminGroupAssignCreatorId = creatorUserId;
    ctx.scene.session.adminGroupAssignTeamLeadId = undefined;

    await ctx.reply(
      [
        `Креатор: ${formatCreatorDisplayName(creator)}`,
        `Текущий тимлид: ${activeLink ? formatTeamLeadDisplayName(activeLink.teamLead) : 'не назначен'}`,
        '',
        'Шаг 2/3. Выбери тимлида для назначения.'
      ].join('\n'),
      entitySelectionKeyboard('admin_group_assign_teamlead', teamLeads)
    );
  });

  bot.action(/^admin_group_assign_teamlead:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_group_assign_teamlead', await buildTeamLeadItems(), page).reply_markup
    );
  });

  bot.action(/^admin_group_assign_teamlead:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const teamLeadUserId = ctx.match[1];
    const creatorUserId = ctx.scene.session.adminGroupAssignCreatorId;
    const [creator, teamLead] = await Promise.all([
      creatorUserId ? container.services.userService.getById(creatorUserId) : null,
      container.services.userService.getById(teamLeadUserId)
    ]);
    await ctx.answerCbQuery();

    if (!creatorUserId || !creator || !canUseCreatorScenario(creator)) {
      await ctx.reply('Не вижу выбранного креатора. Открой раздел "Группы" и начни назначение заново.');
      return;
    }

    if (!teamLead || !canUseTeamLeadScenario(teamLead)) {
      await ctx.reply('Тимлид не найден. Выбери тимлида из списка заново.');
      return;
    }

    const activeLink = await container.repositories.teamLeadRepository.getActiveTeamLeadForCreator(creatorUserId);
    ctx.scene.session.adminGroupAssignTeamLeadId = teamLeadUserId;

    await ctx.reply(
      [
        'Шаг 3/3. Подтверди связку.',
        '',
        `Креатор: ${formatCreatorDisplayName(creator)}`,
        `Новый тимлид: ${formatTeamLeadDisplayName(teamLead)}`,
        `Текущий тимлид: ${activeLink ? formatTeamLeadDisplayName(activeLink.teamLead) : 'не назначен'}`,
        '',
        activeLink && activeLink.teamLeadUserId !== teamLeadUserId
          ? 'После подтверждения старая активная связка будет заменена без дублей.'
          : 'После подтверждения связка будет активна.'
      ].join('\n'),
      approvalInlineKeyboard('admin_group_assign_confirm')
    );
  });

  bot.action('admin_group_assign_confirm', roleGuard(UserRole.ADMIN), async (ctx) => {
    const creatorUserId = ctx.scene.session.adminGroupAssignCreatorId;
    const teamLeadUserId = ctx.scene.session.adminGroupAssignTeamLeadId;
    await ctx.answerCbQuery('Сохраняю связку...');

    if (!creatorUserId || !teamLeadUserId) {
      await ctx.reply(
        'Не хватает выбранного креатора или тимлида. Открой раздел "Группы" и начни назначение заново.'
      );
      return;
    }

    const result = await container.repositories.teamLeadRepository.assignCreatorToTeamLead(
      creatorUserId,
      teamLeadUserId
    );
    ctx.scene.session.adminGroupAssignCreatorId = undefined;
    ctx.scene.session.adminGroupAssignTeamLeadId = undefined;

    await ctx.reply(
      [
        'Связка назначена и сохранена.',
        `Креатор: ${formatCreatorDisplayName(result.link.creator)}`,
        `Тимлид: ${formatTeamLeadDisplayName(result.link.teamLead)}`,
        result.previousTeamLead
          ? `Предыдущая активная связка заменена: ${formatTeamLeadDisplayName(result.previousTeamLead)}`
          : 'Предыдущей активной связки не было или она уже совпадала с выбранной.',
        '',
        'Теперь креатор будет отображаться в группе этого тимлида, а тимлид увидит его в своих разделах.'
      ].join('\n')
    );
  });

  bot.action(/^admin_dashboard:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const monthKey = ctx.match[1];
    await answerCallbackQuerySafely(ctx);

    const creators = await container.services.userService.listCreators();

    if (!creators.length) {
      await ctx.reply(
        'Креаторов пока нет, поэтому статистику за период показать не из чего. После регистрации тестового креатора раздел начнет заполняться.'
      );
      return;
    }

    const [dashboard, report, weeklyMissing, monthlyVideoStatuses, documentSummaries] = await Promise.all([
      container.services.dashboardSummaryService.getAdminSummary(monthKey),
      container.services.adminReportService.getGlobalMonthReport(monthKey),
      container.services.creatorDisciplineService.getWeeklyAttentionForCreators(creators),
      container.services.creatorDisciplineService.getMonthlyVideoStatuses(creators, monthKey),
      container.services.documentStatusService.listCreatorsWithMissingSignedDocuments(creators, monthKey)
    ]);
    const missingMonthlyVideoStatuses = monthlyVideoStatuses.filter((item) => item.status === 'MISSING');

    await ctx.reply(formatAdminDashboardSummary(dashboard));
    await ctx.reply(formatAdminReport(report));
    await ctx.reply(formatMissingWeeklyStats(weeklyMissing));
    await ctx.reply(
      formatMissingMonthlyVideos(missingMonthlyVideoStatuses, monthKey),
      missingMonthlyVideoStatuses.length
        ? adminMissingMonthlyVideosKeyboard(monthKey)
        : undefined
    );
    await ctx.reply(formatMissingDocuments(documentSummaries, monthKey));
    await replyAdminStatsTeamSelection(ctx, monthKey);
  });

  bot.action(/^admin_stats_teams:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const monthKey = ctx.match[1];
    await answerCallbackQuerySafely(ctx);
    await replyAdminStatsTeamSelection(ctx, monthKey);
  });

  bot.action(/^admin_stats_team:(.+):page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const monthKey = ctx.match[1];
    const page = Number(ctx.match[2]);
    await answerCallbackQuerySafely(ctx);
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard(`admin_stats_team:${monthKey}`, await buildTeamLeadItems(), page).reply_markup
    );
  });

  bot.action(/^admin_stats_team:(.+):pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const monthKey = ctx.match[1];
    const teamLeadUserId = ctx.match[2];
    const report = await container.services.teamLeadReportService.getGroupReport(teamLeadUserId, monthKey);
    await answerCallbackQuerySafely(ctx);
    await ctx.reply(formatTeamLeadGroupReport(report));
  });

  bot.action(/^admin_payments:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const monthKey = ctx.match[1];
    await answerCallbackQuerySafely(ctx);

    try {
      const report = await container.services.adminReportService.getGlobalPaymentsReport(monthKey);
      for (const chunk of splitTelegramMessage(formatAdminPaymentsReport(report))) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      logUserError(error, 'Admin payments report failed', {
        userId: ctx.state.currentUser?.id,
        monthKey
      });
      await ctx.reply(
        formatUserError(
          error,
          'Сейчас не удалось собрать сводку по выплатам. Я записал ошибку в лог, попробуй еще раз чуть позже.'
        )
      );
    }
  });

  bot.action(/^admin_creator_pick:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_creator_pick', await buildCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^admin_creator_pick:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creatorUserId = ctx.match[1];
    await ctx.answerCbQuery();
    await replyCreatorProfileCard(ctx, creatorUserId);
  });

  bot.action(/^admin_creator_report_menu:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await container.services.userService.getById(creatorUserId);
    await ctx.answerCbQuery();

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.reply('Креатор не найден. Открой раздел "Креаторы" и выбери из актуального списка.');
      return;
    }

    await ctx.reply(
      'Выбери месяц.',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), `admin_creator_report:${creatorUserId}`)
    );
  });

  bot.action(/^admin_creator_report:(.+):(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const monthKey = ctx.match[2];
    const creator = await container.services.userService.getById(creatorUserId);

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.answerCbQuery();
      await ctx.reply('Креатор не найден. Открой раздел "Креаторы" и выбери из актуального списка.');
      return;
    }

    const report = await container.services.creatorReportService.getMonthlyReport(creatorUserId, monthKey);
    const keyboard = weeklyReportReviewKeyboard(report.weeklyReports, {
      includeReviewButtons: false,
      includeReturnButtons: true
    });
    await ctx.answerCbQuery();
    if (keyboard) {
      await ctx.reply(formatCreatorMonthlyReport(report), keyboard);
      return;
    }

    await ctx.reply(formatCreatorMonthlyReport(report));
  });

  bot.action(/^admin_creator_profile_edit:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_IDS.profileEdit, {
      creatorUserId: ctx.match[1]
    });
  });

  bot.action('admin_creator_access_start', roleGuard(UserRole.ADMIN), async (ctx) => {
    const pendingUsers = await buildPendingAccessItems();
    await ctx.answerCbQuery();

    if (!pendingUsers.length) {
      await ctx.reply(
        'Пользователей для выдачи доступа креатора сейчас нет. Сначала попроси тестового креатора открыть /start.'
      );
      return;
    }

    await ctx.reply(
      'Выбери пользователя, которому нужно выдать доступ креатора.',
      entitySelectionKeyboard('admin_pending_creator', pendingUsers)
    );
  });

  bot.action(/^admin_pending_creator:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_pending_creator', await buildPendingAccessItems(), page).reply_markup
    );
  });

  bot.action(/^admin_pending_creator:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    const user = await container.services.userService.getById(userId);
    await ctx.answerCbQuery();

    if (!user || canUseCreatorScenario(user)) {
      await ctx.reply('Пользователь не найден или доступ креатора уже назначен.');
      return;
    }

    await ctx.reply(
      [
        'Выдать пользователю доступ креатора?',
        '',
        `Пользователь: ${formatFullName(user.firstName, user.lastName, user.username ? `@${user.username}` : user.telegramId)}`,
        'После подтверждения он сможет открыть /start и пройти регистрацию анкеты в личном разделе креатора.'
      ].join('\n'),
      approvalInlineKeyboard(`admin_creator_access_confirm:${user.id}`)
    );
  });

  bot.action(/^admin_creator_access_confirm:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    const user = await container.services.userService.getById(userId);
    await ctx.answerCbQuery('Выдаю доступ...');

    if (!user) {
      await ctx.reply('Пользователь не найден.');
      return;
    }

    const updated = await container.services.userService.grantCreatorAccess(user.id);

    await ctx.reply(
      [
        'Доступ креатора выдан.',
        `Пользователь: ${formatCreatorDisplayName(updated)}`,
        'Теперь попроси его открыть /start. Если анкета еще не заполнена, личный раздел креатора запустит регистрацию.'
      ].join('\n')
    );
  });

  bot.action('admin_creator_access_revoke_start', roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildRevokableCreatorItems();
    await ctx.answerCbQuery();

    if (!creators.length) {
      await ctx.reply('Активных креаторов для запрета доступа сейчас нет.');
      return;
    }

    clearAdminCreatorLookupSession(ctx);
    await ctx.reply('Как найти креатора для блокировки?', adminCreatorLookupKeyboard('revoke'));
  });

  bot.action(/^admin_creator_access_revoke:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_creator_access_revoke', await buildRevokableCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^admin_creator_access_revoke:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    await replyCreatorAccessRevokeConfirmation(ctx, userId);
  });

  bot.action(/^admin_creator_access_revoke_confirm:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery('Запрещаю доступ...');

    const updated = await container.services.userService.revokeCreatorAccess(userId);

    await ctx.reply(
      ['Доступ креатора запрещен.', `Креатор: ${formatCreatorDisplayName(updated)}`].join('\n')
    );
  });

  bot.action('admin_creator_access_restore_start', roleGuard(UserRole.ADMIN), async (ctx) => {
    const creators = await buildInactiveCreatorItems();
    await ctx.answerCbQuery();

    if (!creators.length) {
      await ctx.reply('Отключенных креаторов для возврата доступа сейчас нет.');
      return;
    }

    clearAdminCreatorLookupSession(ctx);
    await ctx.reply('Как найти креатора для возврата доступа?', adminCreatorLookupKeyboard('restore'));
  });

  bot.action(/^admin_creator_access_restore:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_creator_access_restore', await buildInactiveCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^admin_creator_access_restore:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    await replyCreatorAccessRestoreConfirmation(ctx, userId);
  });

  bot.action(/^admin_creator_access_restore_confirm:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery('Возвращаю доступ...');

    const updated = await container.services.userService.restoreCreatorAccess(userId);

    await ctx.reply(
      ['Доступ креатора возвращен.', `Креатор: ${formatCreatorDisplayName(updated)}`].join('\n')
    );
  });

  bot.action(/^admin_teamlead_pick:page:(\d+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_teamlead_pick', await buildTeamLeadItems(), page).reply_markup
    );
  });

  bot.action(/^admin_teamlead_pick:pick:(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const teamLeadUserId = ctx.match[1];
    const teamLead = await container.services.userService.getById(teamLeadUserId);
    await ctx.answerCbQuery();

    if (!teamLead || !canUseTeamLeadScenario(teamLead)) {
      await ctx.reply('Тимлид не найден. Открой раздел "Тимлиды" и выбери из актуального списка.');
      return;
    }

    await ctx.reply(
      'Выбери месяц.',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), `admin_teamlead_report:${teamLeadUserId}`)
    );
  });

  bot.action(/^admin_teamlead_report:(.+):(.+)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const teamLeadUserId = ctx.match[1];
    const monthKey = ctx.match[2];
    const report = await container.services.teamLeadReportService.getGroupReport(teamLeadUserId, monthKey);
    await ctx.answerCbQuery();
    await ctx.reply(formatTeamLeadGroupReport(report));
  });

  bot.action(/^admin_export_(new|all)_signed_documents$/, documentOperationsGuard(), async (ctx) => {
    if (!config.documents.chatId) {
      await ctx.answerCbQuery('Служебный чат не настроен');
      await ctx.reply('Служебный чат для документов не настроен. Проверь DOCUMENTS_CHAT_ID.');
      return;
    }

    const exportMode = ctx.match[1] as 'new' | 'all';
    const scopeLabel = exportMode === 'all' ? 'все документы' : 'новые документы';

    await ctx.answerCbQuery(`Выгружаю ${scopeLabel}...`);

    try {
      const result = await container.services.documentUploadService.exportPendingSignedDocumentsToChat(
        ctx.telegram,
        config.documents.chatId,
        { includeAlreadyForwarded: exportMode === 'all' }
      );

      if (!result.uploadCount) {
        await ctx.reply(`Файлов для выгрузки нет: ${scopeLabel}.`);
        return;
      }

      await ctx.reply(
        [
          `Выгрузка завершена: ${scopeLabel}.`,
          `Креаторов: ${formatIntegerRu(result.creatorCount)}`,
          `Отправлено файлов: ${formatIntegerRu(result.sentUploads.length)} из ${formatIntegerRu(result.uploadCount)}`,
          result.supersededCount
            ? `Старых дублей пропущено: ${formatIntegerRu(result.supersededCount)}`
            : null,
          result.skippedUploads.length
            ? `Пропущено: ${formatIntegerRu(result.skippedUploads.length)}. Подробности записаны в лог.`
            : null
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      logUserError(error, 'Manual signed documents export failed', {
        adminUserId: ctx.state.currentUser?.id,
        documentsChatId: config.documents.chatId
      });
      await ctx.reply('Не удалось выгрузить документы в рабочий чат. Подробности записаны в лог.');
    }
  });

  bot.action(/^admin_export_(new|all)_payment_documents:(INVOICE|RECEIPT)$/, documentOperationsGuard(), async (ctx) => {
    if (!config.documents.chatId) {
      await ctx.answerCbQuery('Служебный чат не настроен');
      await ctx.reply('Служебный чат для документов не настроен. Проверь DOCUMENTS_CHAT_ID.');
      return;
    }

    const exportMode = ctx.match[1] as 'new' | 'all';
    const type = ctx.match[2] as PaymentDocumentType;
    const label = type === PaymentDocumentType.INVOICE ? 'счета' : 'чеки';
    const scopeLabel = exportMode === 'all' ? `все ${label}` : `новые ${label}`;
    const invoiceMonthKey = getCreatorInvoiceMonthKey();

    await ctx.answerCbQuery(`Выгружаю ${scopeLabel}...`);

    try {
      const result = await container.services.paymentDocumentUploadService.exportPaymentDocumentsToChat(
        ctx.telegram,
        config.documents.chatId,
        {
          type,
          monthKey: invoiceMonthKey,
          includeAlreadyForwarded: exportMode === 'all',
          includeRelatedSignedDocuments: type === PaymentDocumentType.INVOICE
        }
      );

      if (!result.uploadCount) {
        await ctx.reply(`Файлов для выгрузки нет: ${scopeLabel} за ${invoiceMonthKey}.`);
        return;
      }

      await ctx.reply(
        [
          `Выгрузка завершена: ${scopeLabel} за ${invoiceMonthKey}.`,
          `Отправлено файлов: ${formatIntegerRu(result.sentUploads.length)} из ${formatIntegerRu(result.uploadCount)}`,
          type === PaymentDocumentType.INVOICE && result.relatedDocumentCount
            ? `Документов рядом со счетами: ${formatIntegerRu(result.sentRelatedDocuments.length)} из ${formatIntegerRu(result.relatedDocumentCount)}`
            : null,
          result.supersededCount
            ? `Старых дублей пропущено: ${formatIntegerRu(result.supersededCount)}`
            : null,
          result.skippedUploads.length
            ? `Не удалось отправить: ${formatIntegerRu(result.skippedUploads.length)}. Подробности записаны в лог.`
            : null,
          result.skippedRelatedDocuments.length
            ? `Не удалось отправить документы к счетам: ${formatIntegerRu(result.skippedRelatedDocuments.length)}. Подробности записаны в лог.`
            : null
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      logUserError(error, 'Manual payment documents export failed', {
        adminUserId: ctx.state.currentUser?.id,
        documentsChatId: config.documents.chatId,
        type,
        monthKey: invoiceMonthKey
      });
      await ctx.reply(`Не удалось выгрузить ${label} в рабочий чат. Подробности записаны в лог.`);
    }
  });

  bot.action(/^admin_creator_documents_pick:page:(\d+)$/, documentOperationsGuard(), async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      entitySelectionKeyboard('admin_creator_documents_pick', await buildCreatorItems(), page).reply_markup
    );
  });

  bot.action(/^admin_creator_documents_pick:pick:(.+)$/, documentOperationsGuard(), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await container.services.userService.getById(creatorUserId);

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.answerCbQuery();
      await ctx.reply('Креатор не найден. Открой раздел "Документы" и выбери креатора заново.');
      return;
    }

    const [documents, documentSummary, firstQueueSummary, secondQueueSummary] = await Promise.all([
      container.services.documentService.listCreatorDocuments(creatorUserId),
      container.services.documentStatusService.getCreatorSummary(creator, getCurrentMonthKey()),
      container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(creatorUserId),
      container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(creatorUserId)
    ]);
    await ctx.answerCbQuery();
    await ctx.reply(formatActiveRosterFirstQueueStatus(firstQueueSummary));
    await ctx.reply(formatActiveRosterSecondQueueStatus(secondQueueSummary));
    await ctx.reply(
      documents.length
        ? documents
            .map(formatDocumentStatusLine)
            .join('\n\n')
        : [
            'Документов у креатора пока нет.',
            'После завершения регистрации появятся договор и NDA, а месячный пакет можно сформировать из меню креатора или массовым действием.'
          ].join('\n')
    );

    const documentSummaryMessage = [
      `Статус документов ${documentSummary.creatorName} за ${documentSummary.monthKey}`,
      `Не сгенерировано: ${formatIntegerRu(documentSummary.missingGeneratedCount)}`,
      `Не подписано: ${formatIntegerRu(documentSummary.missingSignedCount)}`,
      config.documents.chatId
        ? null
        : 'Служебный чат для документов не настроен: загруженные PDF будут сохраняться в боте без пересылки.'
    ]
      .filter(Boolean)
      .join('\n');

    if (documents.length && config.documents.chatId) {
      await ctx.reply(
        documentSummaryMessage,
        Markup.inlineKeyboard([
          [Markup.button.callback('Отправить комплект в служебный чат', `admin_creator_documents_batch:${creatorUserId}`)]
        ])
      );
    } else {
      await ctx.reply(documentSummaryMessage);
    }
  });

  bot.action(/^admin_creator_documents_batch:(.+)$/, documentOperationsGuard(), async (ctx) => {
    const creatorUserId = ctx.match[1];
    const creator = await container.services.userService.getById(creatorUserId);

    if (!creator || !canUseCreatorScenario(creator)) {
      await ctx.answerCbQuery();
      await ctx.reply('Креатор не найден. Открой раздел "Документы" и выбери креатора заново.');
      return;
    }

    if (!config.documents.chatId) {
      await ctx.answerCbQuery('Служебный чат не настроен');
      await ctx.reply('Служебный чат для документов не настроен. Проверь DOCUMENTS_CHAT_ID.');
      return;
    }

    const documents = await container.services.documentService.listCreatorDocuments(creatorUserId);

    if (!documents.length) {
      await ctx.answerCbQuery('Документов нет');
      await ctx.reply('У этого креатора пока нет документов для отправки комплектом.');
      return;
    }

    try {
      await ctx.answerCbQuery('Отправляю комплект...');
      const result = await container.services.documentService.sendCreatorDocumentsBatchToChat(ctx.telegram, {
        creatorUserId,
        creatorName: formatCreatorDisplayName(creator),
        chatId: config.documents.chatId,
        documents
      });

      await ctx.reply(
        [
          `Комплект документов отправлен в служебный чат: ${result.sentDocuments.length} файл(ов).`,
          result.skippedDocuments.length
            ? `Пропущено: ${result.skippedDocuments.length}. Подробности записаны в лог.`
            : null
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      logUserError(error, 'Creator document batch send failed', {
        adminUserId: ctx.state.currentUser?.id,
        creatorUserId
      });
      await ctx.reply('Не удалось отправить комплект документов в служебный чат. Подробности записаны в лог.');
    }
  });

  bot.action(/^admin_sheets_sync:(stats|socials|payments|documents|all)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const target = ctx.match[1];

    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.answerCbQuery('Google Sheets отключены');
      await ctx.reply(
        'Google Sheets сейчас не подключены, поэтому синхронизацию запустить нельзя. Для проверки включи GOOGLE_SHEETS_SYNC_ENABLED=true и настрой доступ к таблице.'
      );
      return;
    }

    await ctx.answerCbQuery('Запускаю синхронизацию...');

    try {
      if (target === 'all') {
        const result = await container.services.googleSheetsSyncService.syncAll();
        await ctx.reply(
          [
            'Синхронизация всех листов завершена.',
            '',
            formatSheetSyncMessage(result.stats),
            '',
            formatSheetSyncMessage(result.socials),
            '',
            formatSheetSyncMessage(result.payments),
            '',
            formatSheetSyncMessage(result.documents)
          ].join('\n')
        );
        return;
      }

      const result =
        target === 'stats'
          ? await container.services.googleSheetsSyncService.syncStats()
          : target === 'socials'
          ? await container.services.googleSheetsSyncService.syncSocials()
          : target === 'payments'
          ? await container.services.googleSheetsSyncService.syncPayments()
          : await container.services.googleSheetsSyncService.syncDocuments();

      await ctx.reply(formatSheetSyncMessage(result));
    } catch (error) {
      logGoogleSheetsAdminError(error, {
        userId: ctx.state.currentUser?.id,
        target
      });
      await ctx.reply(
        'Не удалось выполнить синхронизацию Google Sheets. Проверь доступ service account к таблице и попробуй еще раз.'
      );
    }
  });

  bot.action('admin_sheets_rebuild_menu', roleGuard(UserRole.ADMIN), async (ctx) => {
    await ctx.answerCbQuery();

    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.reply('Google Sheets сейчас не подключены, поэтому пересборка листов недоступна.');
      return;
    }

    await ctx.reply('Выбери лист для полной пересборки.', googleSheetsRebuildKeyboard());
  });

  bot.action(/^admin_sheets_rebuild:(stats|socials|payments|documents)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const target = ctx.match[1];
    await ctx.answerCbQuery();

    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.reply('Google Sheets сейчас не подключены, поэтому пересборка листов недоступна.');
      return;
    }

    await ctx.reply(
      `Пересобрать лист "${target}" полностью? Это очистит лист и заново запишет данные из базы.`,
      approvalInlineKeyboard(`admin_sheets_rebuild_confirm:${target}`)
    );
  });

  bot.action(/^admin_sheets_rebuild_confirm:(stats|socials|payments|documents)$/, roleGuard(UserRole.ADMIN), async (ctx) => {
    const target = ctx.match[1] as 'stats' | 'socials' | 'payments' | 'documents';

    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.answerCbQuery('Google Sheets отключены');
      await ctx.reply('Google Sheets сейчас не подключены, поэтому пересборка листов недоступна.');
      return;
    }

    await ctx.answerCbQuery('Пересобираю лист...');
    try {
      const result = await container.services.googleSheetsSyncService.rebuildSheet(target);
      await ctx.reply(formatSheetSyncMessage(result));
    } catch (error) {
      logGoogleSheetsAdminError(error, {
        userId: ctx.state.currentUser?.id,
        target,
        rebuild: true
      });
      await ctx.reply(
        'Не удалось пересобрать лист Google Sheets. Проверь доступ service account к таблице и попробуй еще раз.'
      );
    }
  });

  bot.action('admin_sheets_test', roleGuard(UserRole.ADMIN), async (ctx) => {
    if (!container.services.googleSheetsSyncService.isEnabled()) {
      await ctx.answerCbQuery('Google Sheets отключены');
      await ctx.reply(
        'Google Sheets сейчас не подключены. Проверка подключения станет доступна после настройки GOOGLE_SHEETS_SYNC_ENABLED=true.'
      );
      return;
    }

    try {
      const info = await container.services.googleSheetsSyncService.testConnection();
      await ctx.answerCbQuery('Google Sheets подключены');
      await ctx.reply(formatGoogleSheetsConnectionMessage(info));
    } catch (error) {
      logGoogleSheetsAdminError(error, {
        userId: ctx.state.currentUser?.id,
        target: 'test_connection'
      });
      await ctx.answerCbQuery('Не удалось проверить таблицу');
      await ctx.reply(
        'Не удалось проверить подключение к Google Sheets. Проверь доступ service account к таблице и попробуй еще раз.'
      );
    }
  });

  bot.action(/^admin_bulk:(.+)$/, documentOperationsGuard(), async (ctx) => {
    const action = ctx.match[1];
    await ctx.answerCbQuery();

    if (!knownBulkActions.has(action)) {
      await ctx.reply('Неизвестное массовое действие. Открой раздел "Массовые действия" и выбери кнопку из списка.');
      return;
    }

    if (
      (action === 'sync_payments' || action === 'sync_documents') &&
      !container.services.googleSheetsSyncService.isEnabled()
    ) {
      await ctx.reply(
        'Google Sheets сейчас не подключены, поэтому массовая синхронизация недоступна. Остальные массовые действия можно проверять без таблицы.'
      );
      return;
    }

    if (action === 'remind_weekly_stats') {
      await ctx.reply(
        'Отправить напоминание всем, кто не сдал недельную статистику?',
        approvalInlineKeyboard('admin_bulk_confirm:remind_weekly_stats')
      );
      return;
    }

    if (action === 'generate_first_queue') {
      await ctx.reply(
        'Сформировать и отправить первую очередь документов действующему составу?',
        approvalInlineKeyboard('admin_bulk_confirm:generate_first_queue')
      );
      return;
    }

    if (action === 'generate_second_queue') {
      await ctx.reply(
        'Сформировать и отправить вторую очередь действующему составу: задание и акт? Документы будут доступны только тем, у кого закрыта первая очередь.',
        approvalInlineKeyboard('admin_bulk_confirm:generate_second_queue')
      );
      return;
    }

    await ctx.reply(
      'Выбери месяц для массовой операции.',
      reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), `admin_bulk_month:${action}`)
    );
  });

  bot.action(/^admin_bulk_month:([^:]+):(.+)$/, documentOperationsGuard(), async (ctx) => {
    const action = ctx.match[1];
    const monthKey = ctx.match[2];
    await ctx.answerCbQuery();

    if (!knownBulkActions.has(action)) {
      await ctx.reply('Неизвестное массовое действие. Открой раздел "Массовые действия" и выбери кнопку из списка.');
      return;
    }

    if (
      (action === 'sync_payments' || action === 'sync_documents') &&
      !container.services.googleSheetsSyncService.isEnabled()
    ) {
      await ctx.reply('Google Sheets сейчас не подключены, поэтому массовая синхронизация недоступна.');
      return;
    }

    await ctx.reply(
      action === 'await_receipts'
        ? `Поставить статус "жду чеки" за ${monthKey}? Напоминание уйдет через 36 часов тем, кто не загрузит чек.`
        : action === 'generate_documents'
          ? `Подтвердить массовую генерацию заданий за ${monthKey}?`
        : `Подтвердить массовую операцию "${action}" за ${monthKey}?`,
      approvalInlineKeyboard(`admin_bulk_confirm:${action}:${monthKey}`)
    );
  });

  bot.action(/^admin_bulk_confirm:([^:]+)(?::(.+))?$/, documentOperationsGuard(), async (ctx) => {
    const action = ctx.match[1];
    const monthKey = ctx.match[2];

    if (!knownBulkActions.has(action)) {
      await ctx.answerCbQuery();
      await ctx.reply('Неизвестное массовое действие. Открой раздел "Массовые действия" и выбери кнопку из списка.');
      return;
    }

    if (
      (action === 'sync_payments' || action === 'sync_documents') &&
      !container.services.googleSheetsSyncService.isEnabled()
    ) {
      await ctx.answerCbQuery('Google Sheets отключены');
      await ctx.reply('Google Sheets сейчас не подключены, поэтому массовая синхронизация недоступна.');
      return;
    }

    await ctx.answerCbQuery('Запускаю операцию...');

    let result: Awaited<ReturnType<typeof container.services.adminBulkOperationsService.remindMissingWeeklyStats>> | null;

    try {
      result =
        action === 'remind_weekly_stats'
          ? await container.services.adminBulkOperationsService.remindMissingWeeklyStats(ctx.telegram)
          : action === 'generate_first_queue'
            ? await container.services.adminBulkOperationsService.generateActiveRosterFirstQueueForAll(ctx.telegram)
            : action === 'generate_second_queue'
              ? await container.services.adminBulkOperationsService.generateActiveRosterSecondQueueForAll(ctx.telegram)
              : action === 'await_receipts' && monthKey
                ? await container.services.adminBulkOperationsService.markAwaitingReceiptsForMonth(monthKey)
                : action === 'remind_monthly_videos' && monthKey
                  ? await container.services.adminBulkOperationsService.remindMissingMonthlyVideos(ctx.telegram, monthKey)
                  : action === 'remind_documents' && monthKey
                    ? await container.services.adminBulkOperationsService.remindMissingDocuments(ctx.telegram, monthKey)
                    : action === 'generate_documents' && monthKey
                      ? await container.services.adminBulkOperationsService.generateMonthlyDocumentsForAll(
                          ctx.telegram,
                          monthKey
                        )
                      : action === 'sync_payments' && monthKey
                        ? await container.services.adminBulkOperationsService.syncPaymentsForMonth(monthKey)
                        : action === 'sync_documents'
                          ? await container.services.adminBulkOperationsService.syncDocumentsForAll(monthKey)
                          : null;
    } catch (error) {
      logUserError(error, 'Admin bulk action failed', {
        userId: ctx.state.currentUser?.id,
        action,
        monthKey
      });
      await ctx.reply(
        action === 'sync_payments' || action === 'sync_documents'
          ? 'Не удалось выполнить синхронизацию Google Sheets. Проверь доступ service account к таблице и попробуй еще раз.'
          : 'Не удалось выполнить массовое действие. Попробуй еще раз.'
      );
      return;
    }

    if (!result) {
      await ctx.reply('Не удалось определить массовую операцию. Открой раздел "Массовые действия" заново.');
      return;
    }

    await ctx.reply(formatBulkOperationResult(result));
  });

  bot.on('text', async (ctx, next) => {
    const purpose = ctx.scene.session.adminCreatorLookupPurpose;
    const mode = ctx.scene.session.adminCreatorLookupMode;

    if (!purpose || !mode) {
      await next();
      return;
    }

    if (!canUseAdminScenario(ctx.state.currentUser)) {
      await next();
      return;
    }

    const text = getMessageText(ctx.message)?.trim();

    if (!text) {
      await ctx.reply(adminCreatorLookupInputPrompts[mode]);
      return;
    }

    const creator = await findCreatorByAdminLookup(purpose, mode, text);

    if (!creator) {
      await ctx.reply(
        mode === 'telegramId'
          ? 'Не нашла креатора с таким Telegram ID. Проверь цифры или выбери из списка.'
          : 'Не нашла креатора с таким username. Проверь написание или выбери из списка.',
        adminCreatorLookupKeyboard(purpose)
      );
      return;
    }

    clearAdminCreatorLookupSession(ctx);
    await replyAdminCreatorLookupResult(ctx, purpose, creator.id);
  });

  bot.action('action_cancel', roleGuard(UserRole.ADMIN), async (ctx) => {
    ctx.scene.session.adminGroupAssignCreatorId = undefined;
    ctx.scene.session.adminGroupAssignTeamLeadId = undefined;
    clearAdminCreatorLookupSession(ctx);
    await ctx.answerCbQuery('Действие отменено');
    await ctx.reply('Действие отменено. Можно вернуться в нужный раздел через меню.');
  });
};
