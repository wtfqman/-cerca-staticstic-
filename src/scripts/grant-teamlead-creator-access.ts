import { UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';
import {
  TEAM_LEAD_CREATOR_ACCESS_EXCLUDED_TELEGRAM_IDS,
  shouldGrantCreatorAccessToTeamLead
} from '../utils/teamlead-creator-access';

const formatUserLabel = (user: {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  teamLeadProfile: { displayName: string } | null;
}) => {
  if (user.teamLeadProfile?.displayName) {
    return user.teamLeadProfile.displayName;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }

  return user.username ? `@${user.username}` : user.telegramId;
};

const run = async () => {
  const teamLeads = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: UserRole.TEAMLEAD },
        {
          teamLeadProfile: {
            isNot: null
          }
        }
      ]
    },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      creatorProfile: {
        select: {
          id: true
        }
      },
      teamLeadProfile: {
        select: {
          displayName: true
        }
      }
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { telegramId: 'asc' }]
  });

  let created = 0;
  let existing = 0;
  let skipped = 0;

  console.log(`Teamlead creator access scan. Teamleads found: ${teamLeads.length}`);

  for (const user of teamLeads) {
    const label = formatUserLabel(user);

    if (!shouldGrantCreatorAccessToTeamLead(user.telegramId)) {
      skipped += 1;
      console.log(`- skipped: ${label} (telegramId=${user.telegramId})`);
      continue;
    }

    if (user.creatorProfile) {
      existing += 1;
      console.log(`- exists: ${label} (telegramId=${user.telegramId})`);
      continue;
    }

    await prisma.creatorProfile.create({
      data: {
        userId: user.id,
        profileCompleted: false
      }
    });

    created += 1;
    console.log(`- created: ${label} (telegramId=${user.telegramId})`);
  }

  console.log(
    [
      'Teamlead creator access completed.',
      `Created: ${created}.`,
      `Existing: ${existing}.`,
      `Skipped: ${skipped}.`,
      `Excluded Telegram IDs: ${[...TEAM_LEAD_CREATOR_ACCESS_EXCLUDED_TELEGRAM_IDS].join(', ')}.`
    ].join(' ')
  );
};

run()
  .catch((error) => {
    console.error('Teamlead creator access grant failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
