import { Prisma, UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';
import {
  KNOWN_ADMINS,
  KNOWN_CREATORS,
  KNOWN_TEAM_LEADS,
  type KnownTeamLeadInput,
  type KnownUserInput
} from './known-users';
import { shouldGrantCreatorAccessToTeamLead } from '../utils/teamlead-creator-access';

const TELEGRAM_ID_PATTERN = /^-?\d+$/;
const UNKNOWN_MARKERS = new Set(['unknown']);

type KnownText = string | null | undefined;

interface KnownUserPlan {
  telegramId: string;
  username: KnownText;
  firstName: KnownText;
  lastName: KnownText;
  baseRole: UserRole;
  isActive: boolean;
  requiresCreatorProfile: boolean;
  requiresTeamLeadProfile: boolean;
  removeTeamLeadProfile: boolean;
  deactivateTeamLeadLinks: boolean;
  displayName?: string;
}

interface ReconcileResult {
  action: 'created' | 'updated' | 'unchanged';
  telegramId: string;
  userId: string;
  previousRole: UserRole | null;
  currentRole: UserRole | null;
  previousIsActive: boolean | null;
  currentIsActive: boolean;
  username: string | null;
  firstName: string | null;
  deactivatedTeamLeadLinks: number;
  teamLeadProfile: 'created' | 'updated' | 'unchanged' | 'removed' | 'skipped';
  creatorProfile: 'created' | 'exists' | 'skipped';
}

const userSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  telegramId: true,
  username: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  creatorProfile: {
    select: {
      id: true,
      profileCompleted: true
    }
  },
  teamLeadProfile: {
    select: {
      id: true,
      displayName: true
    }
  }
});

type ReconcileUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const normalizeNullableText = (value: KnownText): KnownText => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (UNKNOWN_MARKERS.has(trimmed.toLowerCase())) {
    return undefined;
  }

  return trimmed;
};

const normalizeUsername = (value: KnownText): KnownText => {
  const normalized = normalizeNullableText(value);

  if (typeof normalized !== 'string') {
    return normalized;
  }

  const username = normalized.replace(/^@/, '').trim();

  if (!username) {
    return null;
  }

  if (UNKNOWN_MARKERS.has(username.toLowerCase())) {
    return undefined;
  }

  return username;
};

const valueForCreate = (value: KnownText) => value ?? null;

const preferKnownValue = (current: KnownText, next: KnownText): KnownText => {
  if (next === undefined) {
    return current;
  }

  if (current === undefined || current === null) {
    return next;
  }

  return current;
};

const validateTelegramId = (telegramId: string) => {
  if (!TELEGRAM_ID_PATTERN.test(telegramId)) {
    throw new Error(`Invalid Telegram ID in known users list: ${telegramId}`);
  }
};

const normalizeKnownUser = (input: KnownUserInput) => {
  const telegramId = input.telegramId.trim();
  validateTelegramId(telegramId);

  return {
    telegramId,
    username: normalizeUsername(input.username),
    firstName: normalizeNullableText(input.firstName),
    lastName: normalizeNullableText(input.lastName)
  };
};

const buildDisplayName = (input: KnownTeamLeadInput) => {
  const explicitDisplayName = normalizeNullableText(input.displayName);

  if (explicitDisplayName) {
    return explicitDisplayName;
  }

  const normalized = normalizeKnownUser(input);
  const fullName = [normalized.firstName, normalized.lastName].filter(Boolean).join(' ').trim();

  if (fullName && normalized.username) {
    return `${fullName} (@${normalized.username})`;
  }

  return fullName || (normalized.username ? `@${normalized.username}` : normalized.telegramId);
};

const chooseBaseRole = (current: UserRole, next: UserRole) => {
  if (current === UserRole.ADMIN || next === UserRole.ADMIN) {
    return UserRole.ADMIN;
  }

  if (current === UserRole.TEAMLEAD || next === UserRole.TEAMLEAD) {
    return UserRole.TEAMLEAD;
  }

  return UserRole.CREATOR;
};

const addOrMergePlan = (plans: Map<string, KnownUserPlan>, next: KnownUserPlan) => {
  const current = plans.get(next.telegramId);

  if (!current) {
    plans.set(next.telegramId, next);
    return;
  }

  plans.set(next.telegramId, {
    telegramId: current.telegramId,
    username: preferKnownValue(current.username, next.username),
    firstName: preferKnownValue(current.firstName, next.firstName),
    lastName: preferKnownValue(current.lastName, next.lastName),
    baseRole: chooseBaseRole(current.baseRole, next.baseRole),
    isActive: current.isActive || next.isActive,
    requiresCreatorProfile: current.requiresCreatorProfile || next.requiresCreatorProfile,
    requiresTeamLeadProfile: current.requiresTeamLeadProfile || next.requiresTeamLeadProfile,
    removeTeamLeadProfile: current.removeTeamLeadProfile || next.removeTeamLeadProfile,
    deactivateTeamLeadLinks: current.deactivateTeamLeadLinks || next.deactivateTeamLeadLinks,
    displayName: current.displayName ?? next.displayName
  });
};

const buildKnownUserPlans = () => {
  const plans = new Map<string, KnownUserPlan>();

  for (const input of KNOWN_ADMINS) {
    const normalized = normalizeKnownUser(input);

    addOrMergePlan(plans, {
      ...normalized,
      baseRole: UserRole.ADMIN,
      isActive: input.isActive ?? true,
      requiresCreatorProfile: false,
      requiresTeamLeadProfile: false,
      removeTeamLeadProfile: false,
      deactivateTeamLeadLinks: false
    });
  }

  for (const input of KNOWN_TEAM_LEADS) {
    const normalized = normalizeKnownUser(input);

    addOrMergePlan(plans, {
      ...normalized,
      baseRole: UserRole.TEAMLEAD,
      isActive: input.isActive ?? true,
      requiresCreatorProfile: shouldGrantCreatorAccessToTeamLead(normalized.telegramId),
      requiresTeamLeadProfile: true,
      removeTeamLeadProfile: false,
      deactivateTeamLeadLinks: false,
      displayName: buildDisplayName(input)
    });
  }

  for (const input of KNOWN_CREATORS) {
    const normalized = normalizeKnownUser(input);

    addOrMergePlan(plans, {
      ...normalized,
      baseRole: UserRole.CREATOR,
      isActive: input.isActive ?? true,
      requiresCreatorProfile: input.requiresCreatorProfile ?? true,
      requiresTeamLeadProfile: false,
      removeTeamLeadProfile: input.removeTeamLeadProfile ?? false,
      deactivateTeamLeadLinks: input.deactivateTeamLeadLinks ?? false
    });
  }

  return [...plans.values()];
};

const buildUserUpdateData = (plan: KnownUserPlan): Prisma.UserUpdateInput => {
  const data: Prisma.UserUpdateInput = {
    role: plan.baseRole,
    isActive: plan.isActive
  };

  if (plan.username !== undefined) {
    data.username = plan.username;
  }

  if (plan.firstName !== undefined) {
    data.firstName = plan.firstName;
  }

  if (plan.lastName !== undefined) {
    data.lastName = plan.lastName;
  }

  return data;
};

const shouldUpdateUser = (existing: ReconcileUser | null, plan: KnownUserPlan) => {
  if (!existing) {
    return false;
  }

  return (
    existing.role !== plan.baseRole ||
    existing.isActive !== plan.isActive ||
    (plan.username !== undefined && existing.username !== plan.username) ||
    (plan.firstName !== undefined && existing.firstName !== plan.firstName) ||
    (plan.lastName !== undefined && existing.lastName !== plan.lastName)
  );
};

const ensureTeamLeadProfile = async (
  tx: Prisma.TransactionClient,
  user: ReconcileUser,
  displayName: string
): Promise<ReconcileResult['teamLeadProfile']> => {
  const action = user.teamLeadProfile
    ? user.teamLeadProfile.displayName === displayName
      ? 'unchanged'
      : 'updated'
    : 'created';

  await tx.teamLeadProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      displayName
    },
    update: {
      displayName
    }
  });

  return action;
};

const ensureCreatorProfile = async (
  tx: Prisma.TransactionClient,
  user: ReconcileUser
): Promise<ReconcileResult['creatorProfile']> => {
  if (user.creatorProfile) {
    return 'exists';
  }

  await tx.creatorProfile.create({
    data: {
      userId: user.id,
      profileCompleted: false
    }
  });

  return 'created';
};

const reconcileKnownUser = async (
  tx: Prisma.TransactionClient,
  plan: KnownUserPlan
): Promise<ReconcileResult> => {
  const existing = await tx.user.findUnique({
    where: { telegramId: plan.telegramId },
    select: userSelect
  });
  const willUpdate = shouldUpdateUser(existing, plan);
  const user = await tx.user.upsert({
    where: { telegramId: plan.telegramId },
    create: {
      telegramId: plan.telegramId,
      username: valueForCreate(plan.username),
      firstName: valueForCreate(plan.firstName),
      lastName: valueForCreate(plan.lastName),
      role: plan.baseRole,
      isActive: plan.isActive
    },
    update: buildUserUpdateData(plan),
    select: userSelect
  });

  const teamLeadProfile = plan.requiresTeamLeadProfile
    ? await ensureTeamLeadProfile(tx, user, plan.displayName ?? plan.telegramId)
    : plan.removeTeamLeadProfile && user.teamLeadProfile
      ? (await tx.teamLeadProfile.delete({ where: { userId: user.id } }), 'removed')
      : 'skipped';
  const creatorProfile = plan.requiresCreatorProfile ? await ensureCreatorProfile(tx, user) : 'skipped';
  const deactivatedTeamLeadLinks =
    plan.isActive && !plan.deactivateTeamLeadLinks
      ? 0
      : (
        await tx.creatorTeamLeadLink.updateMany({
          where: {
            teamLeadUserId: user.id,
            isActive: true
          },
          data: {
            isActive: false
          }
        })
      ).count;

  return {
    action: existing ? (willUpdate ? 'updated' : 'unchanged') : 'created',
    telegramId: user.telegramId,
    userId: user.id,
    previousRole: existing?.role ?? null,
    currentRole: user.role,
    previousIsActive: existing?.isActive ?? null,
    currentIsActive: user.isActive,
    username: user.username,
    firstName: user.firstName,
    deactivatedTeamLeadLinks,
    teamLeadProfile,
    creatorProfile
  };
};

const run = async () => {
  const plans = buildKnownUserPlans();
  const results = await prisma.$transaction(async (tx) => {
    const reconciled: ReconcileResult[] = [];

    for (const plan of plans) {
      reconciled.push(await reconcileKnownUser(tx, plan));
    }

    return reconciled;
  });

  console.log(`Known users reconcile completed. Processed: ${results.length}`);

  for (const result of results) {
    const username = result.username ? `@${result.username}` : 'no username';
    const firstName = result.firstName ?? 'no firstName';

    console.log(
      [
        `- ${result.action}: telegramId=${result.telegramId}`,
        `userId=${result.userId}`,
        `role=${result.previousRole ?? 'null'}->${result.currentRole ?? 'null'}`,
        `active=${String(result.previousIsActive)}->${String(result.currentIsActive)}`,
        `name=${firstName}`,
        username,
        `deactivatedTeamLeadLinks=${result.deactivatedTeamLeadLinks}`,
        `teamLeadProfile=${result.teamLeadProfile}`,
        `creatorProfile=${result.creatorProfile}`
      ].join(', ')
    );
  }
};

run()
  .catch((error) => {
    console.error('Known users reconcile failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
