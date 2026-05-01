import { Scenes } from 'telegraf';
import { DocumentStatus } from '@prisma/client';

import type { BotContext } from '../types/bot-context';
import { container } from '../container';
import { mainMenuKeyboardForUser } from '../keyboards/menu.keyboards';
import { creatorSecondQueueActionsKeyboard, documentSelectionKeyboard } from '../keyboards/inline.keyboards';
import { SCENE_IDS } from './scene-ids';
import {
  formatCreatorSecondQueueScreen,
  formatSignedUploadDocumentTitle,
  formatSignedUploadNextStep,
  formatSignedUploadResultMessage
} from '../documents/document.formatters';
import { isPdfTelegramDocument } from '../documents/document-upload.helpers';
import { formatUserError, logUserError } from '../utils/user-errors';
import { ensureCreatorProfileCompletedForDocuments } from '../creators/creator-documents.flow';

type UploadSceneState = {
  documentId?: string;
};

const signedDocumentStatuses = new Set<string>([DocumentStatus.SIGNED_UPLOADED, DocumentStatus.FORWARDED_TO_CHAT]);

const getState = (ctx: BotContext) => ctx.wizard.state as UploadSceneState;

const isWaitingForSignedPdf = (document: {
  status: DocumentStatus;
  signedUploadedAt?: Date | null;
}) => !signedDocumentStatuses.has(document.status) && !document.signedUploadedAt;

const listUnsignedSignatureUploadDocuments = async (creatorUserId: string) =>
  (await container.services.documentService.listSignatureUploadDocuments(creatorUserId)).filter(isWaitingForSignedPdf);

const buildSignedUploadProgress = async (creatorUserId: string) => {
  const summary = await container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(creatorUserId);

  if (!summary.isCompleted) {
    const signedDocuments = summary.documents.filter((document) => Boolean(document.signedUploadedAt));
    const remainingDocuments = summary.documents.filter((document) => !document.signedUploadedAt);

    return formatSignedUploadNextStep({
      signedCount: signedDocuments.length,
      totalCount: summary.documents.length,
      remainingTitles: remainingDocuments.map(formatSignedUploadDocumentTitle)
    });
  }

  const secondQueueSummary = await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(
    creatorUserId
  );
  const signableSecondQueueDocuments = secondQueueSummary.documents.filter(
    (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
  );

  if (!signableSecondQueueDocuments.length) {
    return 'Первая очередь подписана. Следующий шаг - сформировать акты и передачу прав.';
  }
  const signedSecondQueueDocuments = signableSecondQueueDocuments.filter(
    (document) => signedDocumentStatuses.has(document.status) || Boolean(document.signedUploadedAt)
  );
  const remainingSecondQueueDocuments = signableSecondQueueDocuments.filter(
    (document) => !signedDocumentStatuses.has(document.status) && !document.signedUploadedAt
  );

  return formatSignedUploadNextStep({
    signedCount: signedSecondQueueDocuments.length,
    totalCount: signableSecondQueueDocuments.length,
    remainingTitles: remainingSecondQueueDocuments.map(formatSignedUploadDocumentTitle)
  });
};

const buildCreatorInvoicePrompt = async (creatorUserId: string) => {
  const summary = await container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(creatorUserId);

  if (!summary.isCompleted) {
    return null;
  }

  return {
    text: formatCreatorSecondQueueScreen(summary),
    keyboard: creatorSecondQueueActionsKeyboard({
      isCompleted: true,
      hasGeneratedDocuments: true,
      hasAvailableDocuments: true
    })
  };
};

export const documentUploadScene = new Scenes.WizardScene<BotContext>(
  SCENE_IDS.signedDocumentUpload,
  async (ctx) => {
    if (!(await ensureCreatorProfileCompletedForDocuments(ctx))) {
      return;
    }

    const documents = await listUnsignedSignatureUploadDocuments(ctx.state.currentUser!.id);

    if (!documents.length) {
      await ctx.reply(
        'Сейчас нет документов, к которым можно загрузить подписанный PDF.',
        mainMenuKeyboardForUser(ctx.state.currentUser)
      );
      await ctx.scene.leave();
      return;
    }

    await ctx.reply('Выбери документ, который загружаешь или обновляешь.', documentSelectionKeyboard(documents));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data.startsWith('document_upload_pick:')) {
      getState(ctx).documentId = ctx.callbackQuery.data.split(':')[1];
      await ctx.answerCbQuery();
      await ctx.reply('Теперь пришли подписанный PDF одним документом. Если этот документ уже был подписан, новый файл сохранится как последняя версия.');
      return ctx.wizard.next();
    }

    await ctx.reply('Сначала выбери документ кнопкой.');
  },
  async (ctx) => {
    if (!ctx.message || !('document' in ctx.message)) {
      await ctx.reply('Жду PDF-файл именно как документ. Если нужно выйти без загрузки, нажми /cancel.');
      return;
    }

    if (!getState(ctx).documentId) {
      const documents = await listUnsignedSignatureUploadDocuments(ctx.state.currentUser!.id);

      if (!documents.length) {
        await ctx.reply(
          'Не вижу документов, к которым можно загрузить подписанный PDF.',
          mainMenuKeyboardForUser(ctx.state.currentUser)
        );
        await ctx.scene.leave();
        return;
      }

      await ctx.reply(
        'Не вижу, к какому документу привязать файл. Сначала выбери документ кнопкой из списка.',
        documentSelectionKeyboard(documents)
      );
      return ctx.wizard.selectStep(1);
    }

    if (!isPdfTelegramDocument(ctx.message.document)) {
      await ctx.reply('Нужен именно PDF-файл. Отправь документ с расширением .pdf.');
      return;
    }

    try {
      const result = await container.services.documentUploadService.acceptSignedPdf({
        telegram: ctx.telegram,
        creatorUserId: ctx.state.currentUser!.id,
        documentId: getState(ctx).documentId!,
        telegramFileId: ctx.message.document.file_id,
        telegramDocumentId: ctx.message.document.file_unique_id,
        originalFileName: ctx.message.document.file_name ?? 'signed.pdf',
        mimeType: ctx.message.document.mime_type
      });
      const nextStep = await buildSignedUploadProgress(ctx.state.currentUser!.id);
      const invoicePrompt = await buildCreatorInvoicePrompt(ctx.state.currentUser!.id);
      const documents = await listUnsignedSignatureUploadDocuments(ctx.state.currentUser!.id);

      getState(ctx).documentId = undefined;

      await ctx.reply(
        formatSignedUploadResultMessage(result.forwarding, {
          wasAlreadySigned: result.wasAlreadySigned,
          document: result.document,
          nextStep
        }),
        documents.length
          ? documentSelectionKeyboard(documents)
          : invoicePrompt?.keyboard ?? mainMenuKeyboardForUser(ctx.state.currentUser)
      );

      if (invoicePrompt && documents.length) {
        await ctx.reply(invoicePrompt.text, invoicePrompt.keyboard);
      }

      if (!documents.length) {
        await ctx.scene.leave();
        return;
      }

      if (!invoicePrompt) {
        await ctx.reply('Если нужно загрузить еще один подписанный PDF, выбери следующий документ кнопкой.');
      }
      return ctx.wizard.selectStep(1);
    } catch (error) {
      logUserError(error, 'Signed document upload failed', {
        userId: ctx.state.currentUser?.id,
        documentId: getState(ctx).documentId
      });
      await ctx.reply(formatUserError(error, 'Сейчас не удалось принять документ. Попробуй еще раз немного позже.'));
    }
  }
);
