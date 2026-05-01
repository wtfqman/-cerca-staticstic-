import type { Context } from 'telegraf';

const CALLBACK_QUERY_EXPIRED_PATTERN = /query is too old|response timeout expired|query ID is invalid/i;

export const isExpiredCallbackQueryError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: unknown }).code;

  return code === 400 && CALLBACK_QUERY_EXPIRED_PATTERN.test(error.message);
};

export const safeAnswerCbQuery = async (ctx: Context, text?: string) => {
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    if (!isExpiredCallbackQueryError(error)) {
      throw error;
    }
  }
};
