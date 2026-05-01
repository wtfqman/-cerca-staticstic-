const DEFAULT_TEMPORARY_CREATOR_INVITE_PAYLOAD = 'creator_weekend_2026';
const DEFAULT_TEMPORARY_CREATOR_INVITE_EXPIRES_AT = '2026-05-04T00:00:00+03:00';

interface TemporaryCreatorInviteConfig {
  enabled: boolean;
  payload: string;
  expiresAt: Date;
}

export interface TemporaryCreatorInviteDecision extends TemporaryCreatorInviteConfig {
  matches: boolean;
  expired: boolean;
  active: boolean;
}

export const parseStartPayload = (messageText: string): string => {
  const [command, ...payloadParts] = messageText.trim().split(/\s+/);

  if (!command?.startsWith('/start')) {
    return '';
  }

  return payloadParts.join(' ').trim();
};

export const getTemporaryCreatorInviteConfig = (): TemporaryCreatorInviteConfig => {
  const payload =
    process.env.TEMP_CREATOR_INVITE_PAYLOAD?.trim() || DEFAULT_TEMPORARY_CREATOR_INVITE_PAYLOAD;
  const expiresAtRaw =
    process.env.TEMP_CREATOR_INVITE_EXPIRES_AT?.trim() || DEFAULT_TEMPORARY_CREATOR_INVITE_EXPIRES_AT;
  const expiresAt = new Date(expiresAtRaw);

  return {
    enabled: process.env.TEMP_CREATOR_INVITE_ENABLED !== 'false',
    payload,
    expiresAt: Number.isNaN(expiresAt.getTime())
      ? new Date(DEFAULT_TEMPORARY_CREATOR_INVITE_EXPIRES_AT)
      : expiresAt
  };
};

export const getTemporaryCreatorInviteDecision = (
  startPayload: string,
  now: Date = new Date()
): TemporaryCreatorInviteDecision => {
  const config = getTemporaryCreatorInviteConfig();
  const matches = Boolean(startPayload) && startPayload === config.payload;
  const expired = now.getTime() >= config.expiresAt.getTime();

  return {
    ...config,
    matches,
    expired,
    active: matches && config.enabled && !expired
  };
};

export const formatTemporaryCreatorInviteExpiry = (expiresAt: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(expiresAt);

export const temporaryCreatorInviteLinkHint = (): string => {
  const { payload } = getTemporaryCreatorInviteConfig();
  return `https://t.me/<bot_username>?start=${encodeURIComponent(payload)}`;
};
