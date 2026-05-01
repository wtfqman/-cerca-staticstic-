import { container } from '../container';
import { DocumentStatus, LegalType } from '@prisma/client';
import {
  creatorFirstQueueActionsKeyboard,
  noContractCreatorPaymentKeyboard,
  creatorSecondQueueActionsKeyboard
} from '../keyboards/inline.keyboards';
import { mainMenuKeyboardForUser, mainMenuTextForUser } from '../keyboards/menu.keyboards';
import {
  formatCreatorFirstQueueScreen,
  formatCreatorSecondQueueScreen
} from '../documents/document.formatters';
import type {
  ActiveRosterFirstQueueDocumentStatus,
  ActiveRosterFirstQueueSummary
} from '../services/document-workflow.service';
import { SCENE_IDS } from '../scenes/scene-ids';
import type { BotContext } from '../types/bot-context';
import { logUserError } from '../utils/user-errors';
import { canUseCreatorScenario } from '../utils/access';
import { safeAnswerCbQuery } from '../utils/telegram-callback';
import { isNoContractCreatorProfile } from '../utils/creator-registration-mode';

export const CREATOR_PROFILE_REQUIRED_FOR_DOCUMENTS_TEXT =
  'Сначала нужно заполнить анкету. После этого я смогу сформировать документы.';
const CREATOR_PASSPORT_DEPARTMENT_CODE_REQUIRED_TEXT =
  'В анкете не заполнен код подразделения паспорта. Без него договор сформировать нельзя. Давай дозаполним анкету.';

const needsPassportDepartmentCode = (profile: Awaited<ReturnType<typeof container.services.creatorProfileService.getProfile>>) =>
  profile?.legalType === LegalType.SELF_EMPLOYED &&
  (!profile.passportDepartmentCode || profile.passportDepartmentCode.trim().length === 0);

const FIRST_QUEUE_ALREADY_SENT_TEXT = [
  'Документы уже отправлены.',
  'Подпиши договор, NDA и задания, затем отправь подписанные PDF обратно в бот.',
  'Если нужно получить файлы еще раз, нажми «Отправить документы повторно».'
].join('\n');

const FIRST_QUEUE_SENT_TEXT = [
  'Отправил первую очередь документов: договор, NDA и задания.',
  'Подпиши PDF и отправь подписанные файлы обратно в бот.'
].join('\n');

const FIRST_QUEUE_GENERATION_FAILED_TEXT = [
  'Документы не отправлены.',
  'Пакет должен сформироваться полностью и без ошибок. Администратор проверит шаблоны и данные.'
].join('\n');

const DOCUMENT_VALIDATION_ERROR_PREFIX = 'Документы не сформированы:';

const FIRST_QUEUE_GENERATED_NOT_SENT_TEXT = [
  'Документы уже сформированы, но я не буду отправлять PDF автоматически при входе.',
  'Если нужно получить файлы в чат, нажми «Отправить документы повторно».'
].join('\n');

export type CreatorFirstQueueEntryStatus =
  | 'READY_TO_GENERATE_FIRST_QUEUE'
  | 'FIRST_QUEUE_GENERATED'
  | 'FIRST_QUEUE_SENT'
  | 'WAITING_SIGNED_PDFS'
  | 'SIGNED_PDFS_PARTIAL'
  | 'SIGNED_PDFS_COMPLETED';

const firstQueueDocumentWasSent = (document: ActiveRosterFirstQueueDocumentStatus) =>
  document.status !== 'NOT_GENERATED' &&
  (Boolean(document.sentAt) ||
    document.status === DocumentStatus.SENT_TO_CREATOR ||
    document.status === DocumentStatus.VIEWED_BY_CREATOR ||
    document.status === DocumentStatus.SIGNED_UPLOADED ||
    document.status === DocumentStatus.FORWARDED_TO_CHAT);

const hasAnyFirstQueueDocumentBeenSent = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.some(firstQueueDocumentWasSent);

const hasEveryFirstQueueDocumentBeenSent = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.length > 0 && summary.documents.every(firstQueueDocumentWasSent);

const hasAnyFirstQueueDocumentGenerated = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.some((document) => document.status !== 'NOT_GENERATED');

const hasAnyFirstQueueDocumentSigned = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.some(
    (document) =>
      document.status === DocumentStatus.SIGNED_UPLOADED ||
      document.status === DocumentStatus.FORWARDED_TO_CHAT ||
      Boolean(document.signedUploadedAt)
  );

const hasAllFirstQueueDocumentsGenerated = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.length > 0 && summary.documents.every((document) => document.status !== 'NOT_GENERATED');

const hasNoFirstQueueDocumentsGenerated = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.length > 0 && summary.documents.every((document) => document.status === 'NOT_GENERATED');

const getGeneratedFirstQueueDocumentIds = (summary: ActiveRosterFirstQueueSummary) =>
  summary.documents.flatMap((document) =>
    document.status !== 'NOT_GENERATED' && document.documentId ? [document.documentId] : []
  );

export const resolveCreatorFirstQueueEntryStatus = (
  summary: ActiveRosterFirstQueueSummary
): CreatorFirstQueueEntryStatus => {
  if (summary.isCompleted) {
    return 'SIGNED_PDFS_COMPLETED';
  }

  if (hasNoFirstQueueDocumentsGenerated(summary)) {
    return 'READY_TO_GENERATE_FIRST_QUEUE';
  }

  if (hasAnyFirstQueueDocumentSigned(summary)) {
    return 'SIGNED_PDFS_PARTIAL';
  }

  if (hasEveryFirstQueueDocumentBeenSent(summary)) {
    return 'WAITING_SIGNED_PDFS';
  }

  if (hasAnyFirstQueueDocumentBeenSent(summary)) {
    return 'FIRST_QUEUE_SENT';
  }

  return 'FIRST_QUEUE_GENERATED';
};

const formatFirstQueueGenerationFailureText = (error: unknown) => {
  if (error instanceof Error && error.message.startsWith(DOCUMENT_VALIDATION_ERROR_PREFIX)) {
    return [
      error.message,
      'Исправь данные в анкете или попроси администратора обновить профиль, затем сформируй документы еще раз.'
    ].join('\n');
  }

  return FIRST_QUEUE_GENERATION_FAILED_TEXT;
};

export const ensureCreatorProfileCompletedForDocuments = async (ctx: BotContext) => {
  const currentUser = ctx.state.currentUser;

  if (!currentUser || !canUseCreatorScenario(currentUser)) {
    return true;
  }

  const profile = await container.services.creatorProfileService.getProfile(currentUser.id);

  if (profile?.profileCompleted && !needsPassportDepartmentCode(profile)) {
    return true;
  }

  if (ctx.callbackQuery) {
    await safeAnswerCbQuery(ctx, needsPassportDepartmentCode(profile) ? 'Нужен код подразделения' : 'Сначала анкета');
  }

  await ctx.reply(
    needsPassportDepartmentCode(profile)
      ? CREATOR_PASSPORT_DEPARTMENT_CODE_REQUIRED_TEXT
      : CREATOR_PROFILE_REQUIRED_FOR_DOCUMENTS_TEXT
  );

  if (ctx.scene.current?.id === SCENE_IDS.creatorRegistration) {
    await ctx.reply('Продолжаем регистрацию. Если нужно остановиться, используй /cancel.');
    return false;
  }

  if (ctx.scene.current) {
    await ctx.scene.leave();
  }

  await ctx.scene.enter(SCENE_IDS.creatorRegistration);
  return false;
};

export const openCreatorDocumentsFlow = async (ctx: BotContext) => {
  const creatorUserId = ctx.state.currentUser!.id;
  const profile = await container.services.creatorProfileService.getProfile(creatorUserId);

  if (isNoContractCreatorProfile(profile)) {
    await ctx.reply(
      [
        'Документы по договору для твоего сценария не нужны.',
        'Заполни статистику, а затем можно переходить к счету.'
      ].join('\n'),
      noContractCreatorPaymentKeyboard()
    );
    return;
  }

  const [documents, firstQueueSummary, secondQueueSummary] = await Promise.all([
    container.services.documentService.listCreatorResendableDocuments(creatorUserId),
    container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(creatorUserId),
    container.services.documentWorkflowService.getActiveRosterSecondQueueSummary(creatorUserId)
  ]);
  const hasAvailableDocuments = documents.length > 0;
  const hasGeneratedFirstQueueDocuments = hasAllFirstQueueDocumentsGenerated(firstQueueSummary);
  const hasGeneratedSecondQueueDocuments =
    secondQueueSummary.documents.length > 0 &&
    secondQueueSummary.documents.every(
      (document) => document.status !== 'LOCKED' && document.status !== 'NOT_GENERATED'
    );

  if (!firstQueueSummary.isCompleted) {
    await ctx.reply(
      formatCreatorFirstQueueScreen(firstQueueSummary),
      creatorFirstQueueActionsKeyboard({
        hasGeneratedDocuments: hasGeneratedFirstQueueDocuments,
        hasAvailableDocuments
      })
    );
    return;
  }

  await ctx.reply(
    formatCreatorSecondQueueScreen(secondQueueSummary),
    creatorSecondQueueActionsKeyboard({
      isCompleted: secondQueueSummary.isCompleted,
      hasGeneratedDocuments: hasGeneratedSecondQueueDocuments,
      hasAvailableDocuments
    })
  );
};

export const openCreatorFirstQueueEntryFlow = async (
  ctx: BotContext,
  options: { profileJustSaved?: boolean; showMenu?: boolean } = {}
) => {
  const showMenu = options.showMenu ?? true;
  const creatorUserId = ctx.state.currentUser!.id;
  const profile = await container.services.creatorProfileService.getProfile(creatorUserId);

  if (isNoContractCreatorProfile(profile)) {
    if (options.profileJustSaved) {
      await ctx.reply('Анкета сохранена. Для твоего сценария договор не нужен.');
    }

    await ctx.reply(
      [
        'Следующий шаг - статистика.',
        'Заполни показатели за нужный период. После статистики можно будет выставить счет.'
      ].join('\n'),
      mainMenuKeyboardForUser(ctx.state.currentUser)
    );
    return;
  }

  if (options.profileJustSaved) {
    await ctx.reply('Анкета сохранена. Теперь можно перейти к документам.');
  }

  const summary = await container.services.documentWorkflowService.getActiveRosterFirstQueueSummary(creatorUserId);
  const generatedDocumentIds = getGeneratedFirstQueueDocumentIds(summary);
  const entryStatus = resolveCreatorFirstQueueEntryStatus(summary);

  if (entryStatus === 'SIGNED_PDFS_COMPLETED') {
    await openCreatorDocumentsFlow(ctx);
    if (showMenu) {
      await ctx.reply(mainMenuTextForUser(ctx.state.currentUser), mainMenuKeyboardForUser(ctx.state.currentUser));
    }
    return;
  }

  if (entryStatus === 'READY_TO_GENERATE_FIRST_QUEUE') {
    try {
      const documents = await container.services.documentService.generateActiveRosterResigningFirstQueueDocuments(
        creatorUserId,
        ctx.telegram
      );

      await ctx.reply(
        FIRST_QUEUE_SENT_TEXT,
        creatorFirstQueueActionsKeyboard({
          hasGeneratedDocuments: true,
          hasAvailableDocuments: documents.length > 0
        })
      );
    } catch (error) {
      logUserError(error, 'Active roster first queue generation after registration failed', {
        userId: ctx.state.currentUser?.id
      });
      await ctx.reply(formatFirstQueueGenerationFailureText(error));
    }

    if (showMenu) {
      await ctx.reply(mainMenuTextForUser(ctx.state.currentUser), mainMenuKeyboardForUser(ctx.state.currentUser));
    }
    return;
  }

  if (
    entryStatus === 'WAITING_SIGNED_PDFS' ||
    entryStatus === 'FIRST_QUEUE_SENT' ||
    entryStatus === 'SIGNED_PDFS_PARTIAL'
  ) {
    await ctx.reply(
      FIRST_QUEUE_ALREADY_SENT_TEXT,
      creatorFirstQueueActionsKeyboard({
        hasGeneratedDocuments: true,
        hasAvailableDocuments: generatedDocumentIds.length > 0
      })
    );
  } else {
    await ctx.reply(
      entryStatus === 'FIRST_QUEUE_GENERATED'
        ? FIRST_QUEUE_GENERATED_NOT_SENT_TEXT
        : formatCreatorFirstQueueScreen(summary),
      creatorFirstQueueActionsKeyboard({
        hasGeneratedDocuments: hasAnyFirstQueueDocumentGenerated(summary),
        hasAvailableDocuments: generatedDocumentIds.length > 0
      })
    );
  }

  if (showMenu) {
    await ctx.reply(mainMenuTextForUser(ctx.state.currentUser), mainMenuKeyboardForUser(ctx.state.currentUser));
  }
};

export const startCreatorDocumentsAfterRegistration = async (ctx: BotContext) => {
  await openCreatorFirstQueueEntryFlow(ctx, {
    profileJustSaved: true,
    showMenu: true
  });
};
