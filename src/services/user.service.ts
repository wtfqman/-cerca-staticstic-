import { UserRole } from '@prisma/client';

import { UserRepository } from '../repositories/user.repository';
import { TeamLeadBootstrapService, type TeamLeadBootstrapInput } from './teamlead-bootstrap.service';
import { canUseAdminScenario, canUseCreatorScenario, canUseTeamLeadScenario } from '../utils/access';

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  getById(userId: string) {
    return this.userRepository.findById(userId);
  }

  listByIds(ids: string[]) {
    return this.userRepository.listByIds(ids);
  }

  getByTelegramId(telegramId: string) {
    return this.userRepository.findByTelegramId(telegramId);
  }

  updateRole(userId: string, role: UserRole) {
    return this.userRepository.updateRole(userId, role);
  }

  listCreators() {
    return this.userRepository.listCreators();
  }

  listInactiveCreators() {
    return this.userRepository.listInactiveCreators();
  }

  listRevokableCreators() {
    return this.userRepository.listRevokableCreators();
  }

  listPendingAccess() {
    return this.userRepository.listCreatorAccessCandidates();
  }

  listTeamLeads() {
    return this.userRepository.listTeamLeads();
  }

  async grantCreatorAccess(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (canUseCreatorScenario(user)) {
      return user;
    }

    if (!user.role) {
      return this.userRepository.updateRole(user.id, UserRole.CREATOR);
    }

    if (canUseAdminScenario(user)) {
      return this.userRepository.ensureCreatorProfile(user.id);
    }

    if (canUseTeamLeadScenario(user)) {
      return this.userRepository.ensureCreatorProfile(user.id, { resetCompleted: true });
    }

    throw new Error('Creator access can be granted only to a pending user, an admin or a teamlead.');
  }

  async grantTemporaryCreatorAccess(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.TEAMLEAD || user.teamLeadProfile) {
      return {
        status: 'SKIPPED_EXISTING_ROLE' as const,
        user
      };
    }

    if (canUseCreatorScenario(user)) {
      return {
        status: 'ALREADY_CREATOR' as const,
        user
      };
    }

    if (user.role && user.role !== UserRole.CREATOR) {
      throw new Error('Temporary creator access can be granted only to a pending or creator user.');
    }

    let updatedUser = user;

    if (updatedUser.role !== UserRole.CREATOR) {
      updatedUser = await this.userRepository.updateRole(updatedUser.id, UserRole.CREATOR);
    }

    if (!updatedUser.isActive) {
      updatedUser = await this.userRepository.setActive(updatedUser.id, true);
    }

    if (!updatedUser.creatorProfile) {
      updatedUser = await this.userRepository.ensureCreatorProfile(updatedUser.id, { resetCompleted: true });
    }

    return {
      status: 'GRANTED' as const,
      user: updatedUser
    };
  }

  async revokeCreatorAccess(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (!canUseCreatorScenario(user) || user.role !== UserRole.CREATOR) {
      throw new Error('Creator access can be revoked only from a creator-only user.');
    }

    return this.userRepository.setActive(user.id, false);
  }

  async restoreCreatorAccess(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.creatorProfile && user.role !== UserRole.CREATOR) {
      throw new Error('Creator profile not found for restore.');
    }

    return this.userRepository.setActive(user.id, true);
  }

  seedTeamLeads(inputs: TeamLeadBootstrapInput[]) {
    return new TeamLeadBootstrapService(this.userRepository).bootstrapTeamLeads(inputs);
  }

  listAdmins() {
    return this.userRepository.listByRole(UserRole.ADMIN);
  }

  getRoleCounts() {
    return this.userRepository.getCountsByRole();
  }
}
