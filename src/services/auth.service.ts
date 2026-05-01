import { UserRole } from '@prisma/client';

import type { AppUser } from '../types/domain';
import { UserRepository } from '../repositories/user.repository';

interface TelegramIdentity {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly adminTelegramIds: string[]
  ) {}

  async ensureTelegramUser(from: TelegramIdentity): Promise<AppUser> {
    const user = await this.userRepository.createOrUpdateFromTelegram({
      telegramId: String(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name
    });

    if (this.adminTelegramIds.includes(user.telegramId) && user.role !== UserRole.ADMIN) {
      return this.userRepository.updateRole(user.id, UserRole.ADMIN);
    }

    return user;
  }
}
