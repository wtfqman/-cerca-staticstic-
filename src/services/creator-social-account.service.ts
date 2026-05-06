import { SocialPlatform, type CreatorSocialAccount } from '@prisma/client';

import {
  CreatorSocialAccountRepository,
  type CreatorSocialAccountInput
} from '../repositories/creator-social-account.repository';

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
      handleOrUrl: this.validateHandleOrUrl(values[platform])
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
        (platform) => `${creatorSocialPlatformLabels[platform]}: ${values[platform] || 'не указано'}`
      )
    ].join('\n');
  }

  async formatCreatorLinks(creatorUserId: string) {
    const accounts = await this.listByCreatorUserId(creatorUserId);
    return this.formatLinks(accounts);
  }
}
