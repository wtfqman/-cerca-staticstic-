export const TEAM_LEAD_CREATOR_ACCESS_EXCLUDED_TELEGRAM_IDS = new Set([
  '674890842'
]);

export const shouldGrantCreatorAccessToTeamLead = (telegramId?: string | null) => {
  const normalizedTelegramId = telegramId?.trim();

  return Boolean(
    normalizedTelegramId &&
      !TEAM_LEAD_CREATOR_ACCESS_EXCLUDED_TELEGRAM_IDS.has(normalizedTelegramId)
  );
};
