import { SocialPlatform, type CreatorSocialAccount } from '@prisma/client';

import {
  CreatorSocialAccountRepository,
  type CreatorSocialAccountInput
} from '../repositories/creator-social-account.repository';
import {
  formatAssignedTeamLeadName,
  formatCreatorDisplayName
} from '../utils/formatters';

export const creatorSocialPlatformOrder = [
  SocialPlatform.INSTAGRAM,
  SocialPlatform.TIKTOK,
  SocialPlatform.VK,
  SocialPlatform.YOUTUBE
] as const;

export const creatorSocialPlatformLabels: Record<SocialPlatform, string> = {
  [SocialPlatform.INSTAGRAM]: 'Instagram',
  [SocialPlatform.TIKTOK]: 'TikTok',
  [SocialPlatform.VK]: 'VK',
  [SocialPlatform.YOUTUBE]: 'YouTube'
};

type SocialAccountValues = Partial<Record<SocialPlatform, string>>;

const normalizeHandleOrUrl = (value: string) =>
  value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');

type CreatorSocialLinksListItem = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  telegramId?: string | null;
  creatorProfile?: {
    fullName?: string | null;
  } | null;
  creatorAssignments?: Array<{
    teamLead: {
      firstName?: string | null;
      lastName?: string | null;
      telegramId?: string | null;
      teamLeadProfile?: {
        displayName?: string | null;
      } | null;
    };
  }>;
};

const hasUrlScheme = (value: string) => /^https?:\/\//i.test(value);
const hasDomainLikePrefix = (value: string) => /^(?:www\.)?[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(value);

const ensureHttpsUrl = (value: string) => {
  if (hasUrlScheme(value)) {
    return value;
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  return `https://${value}`;
};

const stripOuterSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');
const stripLeadingAt = (value: string) => value.replace(/^@+/, '');

export const formatCreatorSocialAccountUrl = (platform: SocialPlatform, rawValue?: string | null) => {
  const value = normalizeHandleOrUrl(rawValue ?? '');

  if (!value) {
    return '';
  }

  if (hasUrlScheme(value) || value.startsWith('//') || hasDomainLikePrefix(value)) {
    return ensureHttpsUrl(value);
  }

  const normalizedHandle = stripOuterSlashes(value);
  const handleWithoutAt = stripLeadingAt(normalizedHandle);

  if (!handleWithoutAt) {
    return '';
  }

  switch (platform) {
    case SocialPlatform.INSTAGRAM:
      return `https://www.instagram.com/${handleWithoutAt}`;
    case SocialPlatform.TIKTOK:
      return `https://www.tiktok.com/@${handleWithoutAt}`;
    case SocialPlatform.VK:
      return `https://vk.com/${handleWithoutAt}`;
    case SocialPlatform.YOUTUBE:
      if (
        normalizedHandle.startsWith('@') ||
        normalizedHandle.startsWith('channel/') ||
        normalizedHandle.startsWith('c/') ||
        normalizedHandle.startsWith('user/')
      ) {
        return `https://www.youtube.com/${normalizedHandle}`;
      }

      return `https://www.youtube.com/@${handleWithoutAt}`;
    default:
      return value;
  }
};

export class CreatorSocialAccountService {
  constructor(private readonly repository: CreatorSocialAccountRepository) {}

  async listByCreatorUserId(creatorUserId: string) {
    return this.repository.listByCreatorUserId(creatorUserId);
  }

  async listByCreatorUserIds(creatorUserIds: string[]) {
    return this.repository.listByCreatorUserIds(creatorUserIds);
  }

  validateHandleOrUrl(rawValue: string) {
    const value = normalizeHandleOrUrl(rawValue);

    if (!value) {
      throw new Error('Пришли ссылку или username текстом.');
    }

    if (value.length < 2) {
      throw new Error('Ссылка или username должны быть минимум 2 символа.');
    }

    if (value.length > 300) {
      throw new Error('Ссылка слишком длинная. Пришли короткую ссылку или username.');
    }

    return value;
  }

  async saveAll(creatorUserId: string, values: Record<SocialPlatform, string>) {
    const accounts: CreatorSocialAccountInput[] = creatorSocialPlatformOrder.map((platform) => ({
      platform,
      handleOrUrl: formatCreatorSocialAccountUrl(platform, this.validateHandleOrUrl(values[platform]))
    }));

    return this.repository.upsertMany(creatorUserId, accounts);
  }

  mapAccountsToValues(accounts: CreatorSocialAccount[]) {
    return accounts.reduce<SocialAccountValues>((acc, account) => {
      acc[account.platform] = account.handleOrUrl;
      return acc;
    }, {});
  }

  formatLinks(accountsOrValues: CreatorSocialAccount[] | SocialAccountValues) {
    const values = Array.isArray(accountsOrValues)
      ? this.mapAccountsToValues(accountsOrValues)
      : accountsOrValues;

    return [
      'Соцсети:',
      ...creatorSocialPlatformOrder.map(
        (platform) =>
          `${creatorSocialPlatformLabels[platform]}: ${
            formatCreatorSocialAccountUrl(platform, values[platform]) || 'не указано'
          }`
      )
    ].join('\n');
  }

  async formatCreatorLinks(creatorUserId: string) {
    const accounts = await this.listByCreatorUserId(creatorUserId);
    return this.formatLinks(accounts);
  }

  async formatCreatorsLinksList(
    creators: CreatorSocialLinksListItem[],
    options: {
      title?: string;
      includeTeamLead?: boolean;
    } = {}
  ) {
    if (!creators.length) {
      return 'Креаторов пока нет.';
    }

    const accounts = await this.listByCreatorUserIds(creators.map((creator) => creator.id));
    const valuesByCreator = new Map<string, SocialAccountValues>();

    for (const account of accounts) {
      const values = valuesByCreator.get(account.creatorUserId) ?? {};
      values[account.platform] = account.handleOrUrl;
      valuesByCreator.set(account.creatorUserId, values);
    }

    const sortedCreators = [...creators].sort((left, right) =>
      formatCreatorDisplayName(left).localeCompare(formatCreatorDisplayName(right), 'ru')
    );
    const blocks = sortedCreators.map((creator, index) => {
      const values = valuesByCreator.get(creator.id) ?? {};

      return [
        `${index + 1}. ${formatCreatorDisplayName(creator)}`,
        options.includeTeamLead ? `Тимлид: ${formatAssignedTeamLeadName(creator)}` : null,
        ...creatorSocialPlatformOrder.map(
          (platform) =>
            `${creatorSocialPlatformLabels[platform]}: ${
              formatCreatorSocialAccountUrl(platform, values[platform]) || 'не указано'
            }`
        )
      ]
        .filter(Boolean)
        .join('\n');
    });

    return [
      options.title ?? 'Соцсети креаторов',
      `Всего: ${creators.length.toLocaleString('ru-RU')}`,
      '',
      ...blocks
    ].join('\n\n');
  }
}
