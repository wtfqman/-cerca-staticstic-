import { UserRole } from '@prisma/client';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import {
  FirstQueueDocumentPackageIncompleteError,
  isStaleDocumentTemplateError,
  type SentDocumentInfo
} from '../services/document.service';
import { logger } from '../lib/logger';
import { roleGuard } from '../middlewares/role-guard.middleware';
import { ensureCreatorProfileCompletedForDocuments } from '../creators/creator-documents.flow';
import { canUseAdminScenario } from '../utils/access';
import { formatUserError, logUserError } from '../utils/user-errors';
import { safeAnswerCbQuery } from '../utils/telegram-callback';
import {
  creatorFirstQueueActionsKeyboard,
  documentListKeyboard
} from '../keyboards/inline.keyboards';
import { getDocumentTitle } from './document.constants';

const DOCUMENT_PACKAGE_SEND_DEDUPE_MS = 15_000;
const activeDocumentPackageSendKeys = new Set<string>();
const recentDocumentPackageSendAt = new Map<string, number>();

const startDocumentPackageSend = (key: string) => {
  const now = Date.now();
  const recentAt = recentDocumentPackageSendAt.get(key);

  if (activeDocumentPackageSendKeys.has(key) || (recentAt && now - recentAt < DOCUMENT_PACKAGE_SEND_DEDUPE_MS)) {
    return false;
  }

  activeDocumentPackageSendKeys.add(key);
  return true;
};

const finishDocumentPackageSend = (key: string, markCompleted: boolean) => {
  activeDocumentPackageSendKeys.delete(key);

  if (!markCompleted) {
    return;
  }

  recentDocumentPackageSendAt.set(key, Date.now());
  const cleanupTimer = setTimeout(
    () => recentDocumentPackageSendAt.delete(key),
    DOCUMENT_PACKAGE_SEND_DEDUPE_MS
  );
  (cleanupTimer as { unref?: () => void }).unref?.();
};

export const registerDocumentHandlers = (bot: Telegraf<BotContext>) => {
  bot.action('document_resend_first_queue', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const currentUser = ctx.state.currentUser!;
    const summary = await container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(currentUser.id);
    const existingDocuments = summary.documents
      .map((document) => ({
        type: document.type,
        monthKey: document.monthKey,
        status: document.status,
        documentId: document.documentId ?? null
      }));
    const sendKey = `${currentUser.id}:first_queue`;

    if (!startDocumentPackageSend(sendKey)) {
      await safeAnswerCbQuery(ctx, 'Уже отправляю комплект...');
      return;
    }

    let packageSent = false;

    try {
      await safeAnswerCbQuery(ctx, 'Собираю свежий пакет...');
      logger.info(
        {
          userId: currentUser.id,
          existingDocuments
        },
        'First queue manual resend requested; regenerating package before send'
      );
      await ctx.reply('Собираю свежий пакет первой очереди и сразу отправлю PDF. Это может занять немного времени.');
      await container.services.documentService.generateActiveRosterResigningFirstQueueDocuments(
        currentUser.id,
        undefined,
        { syncSheets: false }
      );

      const sentDocuments = await container.services.documentService.sendActiveRosterResigningFirstQueueDocuments(
        currentUser.id,
        ctx.telegram,
        { syncSheets: false }
      );
      packageSent = true;
      const sentLines = sentDocuments
        .map((document: SentDocumentInfo) =>
          `- ${document.type}${document.monthKey ? ` ${document.monthKey}` : ''}: sent`
        )
        .join('\n');

      logger.info(
        {
          userId: currentUser.id,
          sendDocumentCount: sentDocuments.length,
          documents: sentDocuments.map((document) => ({
            documentId: document.documentId,
            type: document.type,
            monthKey: document.monthKey,
            filePath: document.filePath,
            status: document.status,
            telegramMessageId: document.telegramMessageId
          }))
        },
        'First queue document package sent'
      );

      await ctx.reply(
        [
          `Отправил полный пакет первой очереди повторно: ${sentDocuments.length} PDF.`,
          sentLines,
          'Подпиши PDF и отправь подписанные файлы обратно в бот.'
        ].join('\n'),
        creatorFirstQueueActionsKeyboard({
          hasGeneratedDocuments: true,
          hasAvailableDocuments: true
        })
      );
    } catch (error) {
      if (error instanceof FirstQueueDocumentPackageIncompleteError) {
        logUserError(error, 'First queue document package is incomplete after regeneration', {
          userId: currentUser.id,
          missingDocuments: error.missingDocuments
        });
        await safeAnswerCbQuery(ctx, 'Пакет неполный');
        await ctx.reply(
          'Не удалось собрать полный пакет первой очереди. Я не отправил частичный набор PDF: нужно проверить генерацию NDA и заданий.'
        );
        return;
      }

      if (isStaleDocumentTemplateError(error)) {
        await safeAnswerCbQuery(ctx, 'PDF устарел');
        await ctx.reply(
          'Этот PDF был создан по старому шаблону и не будет отправлен повторно. Нужно сформировать новый пакет из актуальных Google Docs шаблонов.'
        );
        return;
      }

      logUserError(error, 'First queue document resend failed', {
        userId: currentUser.id,
        existingDocuments
      });
      await ctx.reply(
        formatUserError(
          error,
          'Сейчас не удалось отправить документы повторно. Открой "Мои документы" или попробуй позже.'
        )
      );
    } finally {
      finishDocumentPackageSend(sendKey, packageSent);
    }
  });

  bot.action('document_resend_all', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const currentUser = ctx.state.currentUser!;
    const sendKey = `${currentUser.id}:all_documents`;

    if (!startDocumentPackageSend(sendKey)) {
      await safeAnswerCbQuery(ctx, 'Уже отправляю комплект...');
      return;
    }

    await safeAnswerCbQuery(ctx, 'Отправляю комплект...');
    await ctx.reply('Принял. Собираю и отправляю актуальные PDF. Это может занять 1-2 минуты.');

    void (async () => {
      let packageSent = false;

      try {
        const result = await container.services.documentService.sendAllCreatorDocumentsToCreator(
          ctx.telegram,
          currentUser.id,
          { syncSheets: false }
        );
        packageSent = result.sentDocuments.length > 0;

        if (result.sentDocuments.length === 0) {
          await ctx.reply(
            'Не удалось отправить актуальные PDF: файлы не найдены или временно недоступны. Я записал это в лог, администратор сможет проверить комплект.'
          );
          return;
        }

        const sentLines = result.sentDocuments.map((document) =>
          `- ${getDocumentTitle(document.type)}${document.monthKey ? ` (${document.monthKey})` : ''}`
        );
        const skippedLine = result.skippedDocuments.length
          ? `\nНе удалось отправить ${result.skippedDocuments.length} PDF. Я записал это в лог, администратор сможет проверить файл.`
          : '';

        await ctx.reply(
          [
            `Отправил комплект: ${result.sentDocuments.length} PDF.`,
            ...sentLines,
            skippedLine
          ]
            .filter(Boolean)
            .join('\n')
        );
      } catch (error) {
        logUserError(error, 'All creator documents resend failed', {
          userId: currentUser.id
        });
        await ctx.reply(
          formatUserError(
            error,
            'Сейчас не удалось прислать все документы. Открой "Мои документы" или попробуй позже.'
          )
        );
      } finally {
        finishDocumentPackageSend(sendKey, packageSent);
      }
    })();
  });

  bot.action('document_resend_list', roleGuard(UserRole.CREATOR), async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const documents = await container.services.documentService.listCreatorResendableDocuments(ctx.state.currentUser!.id);
    await safeAnswerCbQuery(ctx);

    if (!documents.length) {
      await ctx.reply(
        'Актуальных PDF для повторной отправки пока нет. Старые PDF, созданные по прежнему шаблону, заблокированы и повторно не отправляются.'
      );
      return;
    }

    await ctx.reply('Выбери PDF, который нужно открыть повторно.', documentListKeyboard(documents));
  });

  bot.action(/^document_resend:(.+)$/, roleGuard(UserRole.CREATOR, UserRole.ADMIN), async (ctx) => {
    const documentId = ctx.match[1];
    const currentUser = ctx.state.currentUser!;

    const document = await container.repositories.documentRepository.findById(documentId);

    if (!document) {
      await safeAnswerCbQuery(ctx, 'Документ не найден');
      await ctx.reply('Документ не найден. Открой список документов заново и выбери актуальную кнопку.');
      return;
    }

    if (!canUseAdminScenario(currentUser) && !(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    if (!canUseAdminScenario(currentUser) && document.creatorUserId !== currentUser.id) {
      await safeAnswerCbQuery(ctx, 'Нет доступа');
      await ctx.reply('Этот документ тебе недоступен. Открой раздел "Мои документы" и выбери свой PDF.');
      return;
    }

    try {
      await safeAnswerCbQuery(ctx, 'Отправляю PDF...');
      await container.services.documentService.resendDocument(ctx.telegram, documentId);
      await ctx.reply('Документ отправлен повторно.');
    } catch (error) {
      if (isStaleDocumentTemplateError(error)) {
        await safeAnswerCbQuery(ctx, 'PDF устарел');
        await ctx.reply(
          'Этот PDF был создан по старому шаблону и не будет отправлен повторно. Нужно сформировать новый пакет из актуальных Google Docs шаблонов.'
        );
        return;
      }

      logUserError(error, 'Document resend failed', {
        userId: currentUser.id,
        documentId
      });
      await ctx.reply(
        formatUserError(
          error,
          'Сейчас не удалось отправить документ повторно. Открой список документов заново или попробуй позже.'
        )
      );
    }
  });
};
