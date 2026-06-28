import dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const normalizeUsername = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

const username = getArgValue('--username');
const telegramId = getArgValue('--telegram-id');

const formatUser = (user: {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: UserRole | null;
  isActive: boolean;
}) =>
  [
    user.username ? `@${user.username}` : null,
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
    `telegramId=${user.telegramId}`,
    `userId=${user.id}`,
    `role=${user.role ?? 'null'}`,
    `active=${user.isActive}`
  ]
    .filter(Boolean)
    .join(', ');

const main = async () => {
  if (!username && !telegramId) {
    throw new Error('Use --username <telegram username> or --telegram-id <id>.');
  }

  const user = username
    ? await prisma.user.findFirst({
        where: {
          username: {
            equals: normalizeUsername(username),
            mode: 'insensitive'
          }
        },
        include: {
          creatorProfile: true,
          teamLeadProfile: true
        }
      })
    : await prisma.user.findUnique({
        where: {
          telegramId: telegramId!
        },
        include: {
          creatorProfile: true,
          teamLeadProfile: true
        }
      });

  if (!user) {
    throw new Error(
      username
        ? `User @${normalizeUsername(username)} was not found. They must send /start first.`
        : `User telegramId=${telegramId} was not found. They must send /start first.`
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextRole = user.role === UserRole.ADMIN || user.role === UserRole.TEAMLEAD
      ? user.role
      : UserRole.CREATOR;

    await tx.user.update({
      where: { id: user.id },
      data: {
        role: nextRole,
        isActive: true
      }
    });

    if (!user.creatorProfile) {
      await tx.creatorProfile.create({
        data: {
          userId: user.id,
          profileCompleted: false
        }
      });
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        creatorProfile: true,
        teamLeadProfile: true
      }
    });
  });

  console.log(`Creator access granted: ${formatUser(updated)}`);
};

main()
  .catch((error) => {
    console.error('Creator access grant failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
