import { UserRole, type LegalType } from '@prisma/client';

export type AccessUser = {
  telegramId?: string | null;
  role?: UserRole | null;
  isActive?: boolean | null;
  creatorProfile?: { legalType?: LegalType | null; profileCompleted?: boolean | null } | null;
  teamLeadProfile?: unknown | null;
  documentWorkflowStates?: Array<{
    campaign?: {
      key?: string | null;
      contractDate?: Date | string | null;
      periodMonths?: unknown;
    } | null;
  }> | null;
};

const DOCUMENTS_OPERATOR_TELEGRAM_IDS = new Set(['661899304']);

export const canUseAdminScenario = (user?: AccessUser | null) =>
  Boolean(user?.isActive && user.role === UserRole.ADMIN);

export const canUseDocumentOperationsScenario = (user?: AccessUser | null) =>
  Boolean(user?.isActive && user.telegramId && DOCUMENTS_OPERATOR_TELEGRAM_IDS.has(user.telegramId));

export const canUseCreatorScenario = (user?: AccessUser | null) =>
  Boolean(
    user?.isActive &&
      (user.role === UserRole.CREATOR || Boolean(user.creatorProfile))
  );

export const canUseTeamLeadScenario = (user?: AccessUser | null) =>
  Boolean(
    user?.isActive &&
      (user.role === UserRole.TEAMLEAD || (user.role === UserRole.ADMIN && Boolean(user.teamLeadProfile)))
  );

export const canUseScenario = (user: AccessUser | null | undefined, role: UserRole) => {
  if (role === UserRole.ADMIN) {
    return canUseAdminScenario(user);
  }

  if (role === UserRole.TEAMLEAD) {
    return canUseTeamLeadScenario(user);
  }

  return canUseCreatorScenario(user);
};

export const canUseAnyScenario = (user?: AccessUser | null) =>
  canUseAdminScenario(user) ||
  canUseDocumentOperationsScenario(user) ||
  canUseTeamLeadScenario(user) ||
  canUseCreatorScenario(user);

export const canUseCreatorAndTeamLeadScenarios = (user?: AccessUser | null) =>
  canUseCreatorScenario(user) && canUseTeamLeadScenario(user);

export const canUseAdminAndCreatorScenarios = (user?: AccessUser | null) =>
  canUseAdminScenario(user) && canUseCreatorScenario(user);

export const canUseAdminAndTeamLeadScenarios = (user?: AccessUser | null) =>
  canUseAdminScenario(user) && canUseTeamLeadScenario(user);
