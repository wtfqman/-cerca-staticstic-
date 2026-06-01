import type { AppUser } from '../types/domain';
import { UserRepository } from '../repositories/user.repository';
import { shouldGrantCreatorAccessToTeamLead } from '../utils/teamlead-creator-access';

export interface TeamLeadBootstrapInput {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  isActive?: boolean;
}

export interface TeamLeadBootstrapResult {
  action: 'created' | 'updated';
  telegramId: string;
  userId: string;
  username: string | null;
  displayName: string;
  creatorProfile: 'created' | 'exists' | 'skipped';
  user: AppUser;
}

const normalizeNullableText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeUsername = (value?: string | null) => {
  const normalized = normalizeNullableText(value);
  return normalized?.replace(/^@/, '') ?? null;
};

const buildDisplayName = (input: TeamLeadBootstrapInput) => {
  const fullName = [normalizeNullableText(input.firstName), normalizeNullableText(input.lastName)]
    .filter(Boolean)
    .join(' ')
    .trim();
  const username = normalizeUsername(input.username);

  if (input.displayName?.trim()) {
    return input.displayName.trim();
  }

  if (fullName && username) {
    return `${fullName} (@${username})`;
  }

  return fullName || (username ? `@${username}` : input.telegramId);
};

export class TeamLeadBootstrapService {
  constructor(private readonly userRepository: UserRepository) {}

  async bootstrapTeamLeads(inputs: TeamLeadBootstrapInput[]): Promise<TeamLeadBootstrapResult[]> {
    const results: TeamLeadBootstrapResult[] = [];

    for (const input of inputs) {
      const telegramId = input.telegramId.trim();
      const existing = await this.userRepository.findByTelegramId(telegramId);
      const displayName = buildDisplayName(input);
      const grantCreatorAccess = shouldGrantCreatorAccessToTeamLead(telegramId);
      const user = await this.userRepository.upsertTeamLead({
        telegramId,
        username: normalizeUsername(input.username),
        firstName: normalizeNullableText(input.firstName),
        lastName: normalizeNullableText(input.lastName),
        displayName,
        grantCreatorAccess,
        isActive: input.isActive
      });

      results.push({
        action: existing ? 'updated' : 'created',
        telegramId: user.telegramId,
        userId: user.id,
        username: user.username,
        displayName: user.teamLeadProfile?.displayName ?? displayName,
        creatorProfile: grantCreatorAccess ? (existing?.creatorProfile ? 'exists' : 'created') : 'skipped',
        user
      });
    }

    return results;
  }
}
