import fs from 'node:fs';

import { SocialPlatform } from '@prisma/client';
import { Input } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { ACCESS_PENDING_TEXT, CREATOR_SELF_EDIT_DISABLED_TEXT, HELP_TEXTS } from '../texts/messages';
import { mainMenuKeyboardForUser, mainMenuTextForUser } from '../keyboards/menu.keyboards';
import { creatorProfileSelfEditKeyboard, reportMonthKeyboard } from '../keyboards/inline.keyboards';
import { getCurrentMonthKey, getMonthRange, getPreviousMonthKey, toDateOnly } from '../utils/periods';
import { getMessageText, splitTelegramMessage } from '../utils/telegram';
import { formatIntegerRu } from '../utils/formatters';
import { formatAggregationSnapshot, formatCreatorMonthlyReport } from '../reports/report.formatters';
import { formatSignedUploadResultMessage } from '../documents/document.formatters';
import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { formatUserError, logUserError } from '../utils/user-errors';
import {
  formatTemporaryCreatorInviteExpiry,
  getTemporaryCreatorInviteDecision,
  parseStartPayload
} from '../utils/temporary-creator-invite';
import {
  ensureCreatorProfileCompletedForDocuments,
  openCreatorFirstQueueEntryFlow
} from '../creators/creator-documents.flow';
import { replyCreatorPostStatisticsNextStep } from '../creators/creator-statistics-next-step';
import {
  canUseAdminScenario,
  canUseAnyScenario,
  canUseCreatorScenario,
  canUseTeamLeadScenario
} from '../utils/access';

const REQUIRED_APRIL_REACH_MONTH_KEY = '2026-04';
const REQUIRED_APRIL_SCREENSHOT_COUNT = Object.values(SocialPlatform).length;

export const showMainMenu = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser) {
    await ctx.reply(ACCESS_PENDING_TEXT);
    return;
  }

  const keyboard = mainMenuKeyboardForUser(currentUser);

  if (keyboard) {
    await ctx.reply(mainMenuTextForUser(currentUser), keyboard);
    return;
  }

  await ctx.reply(ACCESS_PENDING_TEXT);
};

const openCreatorFirstQueueEntryFlowInBackground = (ctx: BotContext) => {
  const userId = ctx.state.currentUser?.id;
  const telegramUserId = ctx.from?.id;
  const updateId = ctx.update.update_id;

  void openCreatorFirstQueueEntryFlow(ctx, { showMenu: false }).catch(async (error) => {
    logUserError(error, 'Creator start document flow failed', {
      userId,
      telegramUserId,
      updateId
    });

    try {
      await ctx.reply(
        formatUserError(
          error,
          'Главное меню открыто, но сейчас не удалось проверить документы. Открой документы из меню или попробуй позже.'
        )
      );
    } catch (replyError) {
      logUserError(replyError, 'Creator start document flow failure reply failed', {
        userId,
        telegramUserId,
        updateId
      });
    }
  });
};

export const handleStart = async (ctx: BotContext) => {
  if (!ctx.from) {
    return;
  }

  let user = await container.services.authService.ensureTelegramUser(ctx.from);
  ctx.state.currentUser = user;

  const startPayload = parseStartPayload(getMessageText(ctx.message));
  const temporaryInvite = getTemporaryCreatorInviteDecision(startPayload);

  if (temporaryInvite.matches) {
    if (!temporaryInvite.enabled) {
      await ctx.reply('Временная ссылка для креаторского доступа сейчас отключена.');
    } else if (temporaryInvite.expired) {
      await ctx.reply('Временная ссылка для креаторского доступа уже истекла. Напиши администратору для обычной выдачи доступа.');
    } else {
      const result = await container.services.userService.grantTemporaryCreatorAccess(user.id);
      user = result.user;
      ctx.state.currentUser = user;

      if (result.status === 'SKIPPED_EXISTING_ROLE') {
        await ctx.reply('Ссылка выдает только временный доступ креатора. Твоя текущая роль не изменена.');
      } else {
        await ctx.reply(
          `Временный доступ креатора открыт до ${formatTemporaryCreatorInviteExpiry(
            temporaryInvite.expiresAt
          )}. Заполни анкету и продолжай сценарий в боте.`
        );
      }
    }
  }

  if (!canUseAnyScenario(user)) {
    await ctx.reply(ACCESS_PENDING_TEXT);
    return;
  }

  if (canUseCreatorScenario(user) && !canUseAdminScenario(user) && !canUseTeamLeadScenario(user)) {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    await showMainMenu(ctx);
    openCreatorFirstQueueEntryFlowInBackground(ctx);
    return;
  }

  await showMainMenu(ctx);
};

export const handleMenu = async (ctx: BotContext) => {
  await showMainMenu(ctx);
};

export const handleHelp = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser) {
    await ctx.reply([HELP_TEXTS.common, '', ACCESS_PENDING_TEXT].join('\n'));
    return;
  }

  const roleTexts = [
    canUseAdminScenario(currentUser) ? HELP_TEXTS.admin : null,
    canUseTeamLeadScenario(currentUser) ? HELP_TEXTS.teamLead : null,
    canUseCreatorScenario(currentUser) ? HELP_TEXTS.creator : null
  ].filter(Boolean);

  const text = [HELP_TEXTS.common, ...roleTexts].join('\n\n');

  for (const chunk of splitTelegramMessage(text)) {
    await ctx.reply(chunk);
  }
};

export const handleCancel = async (ctx: BotContext) => {
  if (ctx.scene.current) {
    await ctx.scene.leave();
  }

  await showMainMenu(ctx);
};

export const handleProfile = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser || !canUseCreatorScenario(currentUser)) {
    await ctx.reply('Профиль в этом виде доступен только креатору.');
    return;
  }

  const profile = await container.services.creatorProfileService.getProfile(currentUser.id);

  if (!profile?.profileCompleted) {
    await ensureCreatorProfileCompletedForDocuments(ctx);
    return;
  }

  const socialLinks = await container.services.creatorSocialAccountService.formatCreatorLinks(currentUser.id);
  await ctx.reply(
    [
      container.services.creatorProfileService.formatProfileSummary(profile),
      '',
      socialLinks,
      '',
      'Обновить ссылки можно кнопкой «Мои соцсети».'
    ].join('\n')
  );
  await ctx.reply(CREATOR_SELF_EDIT_DISABLED_TEXT, creatorProfileSelfEditKeyboard());
};

export const handleCreatorMonthReportMenu = async (ctx: BotContext) => {
  await ctx.reply(
    'За какой месяц показать отчет?',
    reportMonthKeyboard(getCurrentMonthKey(), getPreviousMonthKey(), 'creator_month_report')
  );
};

export const handleCreatorWeekReport = async (ctx: BotContext) => {
  const summary = await container.services.creatorReportService.getLastSevenDaysSummary(ctx.state.currentUser!.id);
  await ctx.reply(formatAggregationSnapshot('Сводка за последние 7 дней', summary));
};

const isImageTelegramDocument = (document: { file_name?: string; mime_type?: string }) => {
  const fileName = document.file_name?.toLowerCase() ?? '';

  return (
    document.mime_type?.startsWith('image/') === true ||
    /\.(png|jpe?g|webp)$/i.test(fileName)
  );
};

const getMonthlyReachScreenshotFile = (ctx: BotContext) => {
  if (!ctx.message) {
    return null;
  }

  if ('photo' in ctx.message && ctx.message.photo.length > 0) {
    return ctx.message.photo[ctx.message.photo.length - 1];
  }

  if (
    'document' in ctx.message &&
    !isPdfTelegramDocument(ctx.message.document) &&
    isImageTelegramDocument(ctx.message.document)
  ) {
    return ctx.message.document;
  }

  return null;
};

export const handleMonthlyReachScreenshotUpload = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;
  const file = getMonthlyReachScreenshotFile(ctx);

  if (!currentUser || !canUseCreatorScenario(currentUser) || !file) {
    return false;
  }

  const range = getMonthRange(REQUIRED_APRIL_REACH_MONTH_KEY);
  const report = await container.repositories.weeklyStatsRepository.getReportForPeriod(
    currentUser.id,
    toDateOnly(range.dateFrom),
    toDateOnly(range.dateTo)
  );

  if (!report) {
    await ctx.reply(
      [
        'Скрин не привязан к статистике.',
        'Сначала открой «Охваты март/апрель», внеси охваты за апрель, а потом отправь 4 скрина статистики за апрель.'
      ].join('\n')
    );
    return true;
  }

  const currentCount = await container.services.weeklyStatsService.countAttachments(report.id);

  if (currentCount >= REQUIRED_APRIL_SCREENSHOT_COUNT) {
    await ctx.reply(
      `Скрины за апрель уже сохранены: ${formatIntegerRu(currentCount)}/${formatIntegerRu(
        REQUIRED_APRIL_SCREENSHOT_COUNT
      )}. Можно снова нажать «Сформировать вторую очередь».`
    );
    return true;
  }

  try {
    await container.services.weeklyStatsService.saveAttachment({
      telegram: ctx.telegram,
      reportId: report.id,
      creatorUserId: currentUser.id,
      telegramFileId: file.file_id,
      telegramFileUniqueId: file.file_unique_id
    });

    const updatedCount = await container.services.weeklyStatsService.countAttachments(report.id);

    if (updatedCount < REQUIRED_APRIL_SCREENSHOT_COUNT) {
      await ctx.reply(
        `Скрин сохранен: ${formatIntegerRu(updatedCount)}/${formatIntegerRu(
          REQUIRED_APRIL_SCREENSHOT_COUNT
        )}. Отправь следующий скрин за апрель.`
      );
      return true;
    }

    await ctx.reply(
      'Все 4 скрина за апрель сохранены. Спасибо.',
      mainMenuKeyboardForUser(currentUser)
    );
    await replyCreatorPostStatisticsNextStep(ctx);
  } catch (error) {
    logUserError(error, 'April monthly screenshot save failed outside scene', {
      userId: currentUser.id
    });
    await ctx.reply('Не удалось сохранить скрин за апрель. Отправь файл еще раз или нажми /cancel.');
  }

  return true;
};

export const handleDocumentReplyUpload = async (ctx: BotContext) => {
    const currentUser = ctx.state.currentUser;

    if (
      !currentUser ||
      !canUseCreatorScenario(currentUser) ||
      !ctx.message ||
      !('document' in ctx.message)
    ) {
      return false;
    }

    const isAdmin = canUseAdminScenario(currentUser);

    if (!isPdfTelegramDocument(ctx.message.document)) {
      if (isAdmin) {
        return false;
      }

      await ctx.reply('Нужен именно PDF-файл. Если это подписанный документ, отправь файл с расширением .pdf.');
      return true;
    }

    if (!ctx.message.reply_to_message) {
      if (isAdmin) {
        return false;
      }

      const documents = await container.services.documentService.listSignatureUploadDocuments(currentUser.id);

      if (documents.length === 1) {
        try {
          const result = await container.services.documentUploadService.acceptSignedPdf({
            telegram: ctx.telegram,
            creatorUserId: currentUser.id,
            documentId: documents[0].id,
            telegramFileId: ctx.message.document.file_id,
            telegramDocumentId: ctx.message.document.file_unique_id,
            originalFileName: ctx.message.document.file_name ?? 'signed.pdf',
            mimeType: ctx.message.document.mime_type
          });

          await ctx.reply(
            formatSignedUploadResultMessage(result.forwarding, {
              wasAlreadySigned: result.wasAlreadySigned,
              document: result.document
            })
          );
        } catch (error) {
          logUserError(error, 'Signed document single-candidate upload failed', {
            userId: currentUser.id,
            documentId: documents[0].id
          });
          await ctx.reply(formatUserError(error, 'РЎРµР№С‡Р°СЃ РЅРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРЅСЏС‚СЊ РїРѕРґРїРёСЃР°РЅРЅС‹Р№ PDF. РџРѕРїСЂРѕР±СѓР№ РµС‰Рµ СЂР°Р· РЅРµРјРЅРѕРіРѕ РїРѕР·Р¶Рµ.'));
        }

        return true;
      }

      await ctx.reply('Не могу определить, к какому документу привязать этот PDF. Нажми «Отправить подписанный PDF» в меню и выбери документ из списка.');
      return true;
    }

    const document = await container.services.documentService.findDocumentByReplyContext(
      currentUser.id,
      ctx.message.reply_to_message.message_id
    );

    if (!document) {
      if (isAdmin) {
        return false;
      }

      await ctx.reply('Не нашел документ, к которому нужно привязать этот файл. Нажми «Отправить подписанный PDF» и выбери документ из списка.');
      return true;
    }

    try {
      const result = await container.services.documentUploadService.acceptSignedPdf({
        telegram: ctx.telegram,
        creatorUserId: currentUser.id,
        documentId: document.id,
        telegramFileId: ctx.message.document.file_id,
        telegramDocumentId: ctx.message.document.file_unique_id,
        originalFileName: ctx.message.document.file_name ?? 'signed.pdf',
        mimeType: ctx.message.document.mime_type
      });

      await ctx.reply(
        formatSignedUploadResultMessage(result.forwarding, {
          wasAlreadySigned: result.wasAlreadySigned,
          document: result.document
        })
      );
    } catch (error) {
      logUserError(error, 'Signed document reply upload failed', {
        userId: currentUser.id,
        replyMessageId: ctx.message.reply_to_message.message_id
      });
      await ctx.reply(formatUserError(error, 'Сейчас не удалось принять подписанный PDF. Попробуй еще раз немного позже.'));
    }

    return true;
};

export const handleCreatorMonthReportCallback = async (ctx: BotContext, monthKey: string) => {
  const report = await container.services.creatorReportService.getMonthlyReport(ctx.state.currentUser!.id, monthKey);
  await ctx.reply(formatCreatorMonthlyReport(report));
};

export const handleWeeklyStatAttachments = async (ctx: BotContext, reportId: string) => {
  try {
    const currentUser = ctx.state.currentUser;
    const report = await container.repositories.weeklyStatsRepository.getReportByIdWithRelations(reportId);

    if (!report) {
      await ctx.answerCbQuery('Отчет не найден');
      await ctx.reply('Недельный отчет не найден.');
      return;
    }

    if (currentUser && canUseTeamLeadScenario(currentUser) && !canUseAdminScenario(currentUser)) {
      const hasAccess = report.creator.creatorAssignments.some(
        (assignment) => assignment.teamLeadUserId === currentUser.id
      );

      if (!hasAccess) {
        await ctx.answerCbQuery('Недоступно');
        await ctx.reply('У тебя нет доступа к скринам этого креатора.');
        return;
      }
    }

    if (!canUseAdminScenario(currentUser) && !canUseTeamLeadScenario(currentUser)) {
      await ctx.answerCbQuery('Недоступно');
      await ctx.reply('Скрины недельной статистики доступны администратору и тимлиду.');
      return;
    }

    if (report.attachments.length === 0) {
      await ctx.answerCbQuery('Скринов нет');
      await ctx.reply('Скрины к этому отчету пока не приложены.');
      return;
    }

    await ctx.answerCbQuery('Показываю скрины');
    await ctx.reply(
      `Скрины статистики за ${report.weekStart.toISOString().slice(0, 10)} - ${report.weekEnd
        .toISOString()
        .slice(0, 10)}: ${report.attachments.length}.`
    );

    for (const attachment of report.attachments) {
      const source =
        attachment.filePath && fs.existsSync(attachment.filePath)
          ? Input.fromLocalFile(attachment.filePath)
          : attachment.telegramFileId;

      await ctx.replyWithPhoto(source, {
        caption: `Скрин ${attachment.sortOrder}`
      });
    }
  } catch (error) {
    logUserError(error, 'Weekly stat attachments open failed', {
      userId: ctx.state.currentUser?.id,
      reportId
    });

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Не удалось открыть скрины');
    }

    await ctx.reply(formatUserError(error, 'Сейчас не удалось открыть скрины. Попробуй еще раз.'));
  }
};
