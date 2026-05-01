import { UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';

const DEFAULT_ADMIN_TELEGRAM_ID = '1731711996';
const TELEGRAM_ID_PATTERN = /^-?\d+$/;

const getTelegramId = () => {
  const telegramId = (process.argv[2] ?? DEFAULT_ADMIN_TELEGRAM_ID).trim();

  if (!TELEGRAM_ID_PATTERN.test(telegramId)) {
    throw new Error(`Invalid Telegram ID: ${telegramId}`);
  }

  return telegramId;
};

const run = async () => {
  const telegramId = getTelegramId();
  const existingUser = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      role: true,
      isActive: true
    }
  });

  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      role: UserRole.ADMIN,
      isActive: true
    },
    update: {
      role: UserRole.ADMIN,
      isActive: true
    },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const action = existingUser ? 'updated' : 'created';
  const previousState = existingUser
    ? `previousRole=${existingUser.role ?? 'null'}, previousIsActive=${existingUser.isActive}`
    : 'new user';

  console.log(`Admin grant ${action}: telegramId=${user.telegramId}, userId=${user.id}`);
  console.log(`${previousState} -> role=${user.role}, isActive=${user.isActive}`);
  console.log(`updatedAt=${user.updatedAt.toISOString()}`);
};

run()
  .catch((error) => {
    console.error('Admin grant failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
