import { Prisma, UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { formatCreatorDisplayName, formatTeamLeadDisplayName } from '../utils/formatters';

const args = process.argv.slice(2);

const hasFlag = (name: string) => args.includes(name);

const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));

  if (direct) {
    return direct.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const normalizeLocator = (value?: string) => value?.trim().replace(/^@/, '');

const fromLocator = normalizeLocator(getArgValue('--from') ?? getArgValue('--from-username'));
const toLocator = normalizeLocator(getArgValue('--to') ?? getArgValue('--to-username'));
const apply = hasFlag('--apply');
const includeInactiveSourceLinks = hasFlag('--include-inactive-source-links');
const onlyWithTargetHistory = hasFlag('--only-with-target-history');
const activeUpdatedSinceRaw = getArgValue('--active-updated-since');

const activeUpdatedSince = activeUpdatedSinceRaw ? new Date(activeUpdatedSinceRaw) : null;

if (activeUpdatedSinceRaw && Number.isNaN(activeUpdatedSince?.getTime())) {
  throw new Error(`Invalid --active-updated-since date: ${activeUpdatedSinceRaw}`);
}

const teamLeadUserInclude = Prisma.validator<Prisma.UserInclude>()({
  teamLeadProfile: true
});

type TeamLeadUser = Prisma.UserGetPayload<{ include: typeof teamLeadUserInclude }>;

const formatTeamLead = (teamLead: TeamLeadUser) =>
  `${formatTeamLeadDisplayName(teamLead)} (telegramId=${teamLead.telegramId}, username=${
    teamLead.username ? `@${teamLead.username}` : 'none'
  }, active=${teamLead.isActive})`;

const findTeamLead = async (locator: string, options: { requireActive: boolean }): Promise<TeamLeadUser | null> => {
  const matches = await prisma.user.findMany({
    where: {
      AND: [
        {
          OR: [
            {
              username: locator
            },
            {
              telegramId: locator
            }
          ]
        },
        options.requireActive
          ? {
              isActive: true
            }
          : {},
        {
          OR: [
            {
              role: UserRole.TEAMLEAD
            },
            {
              teamLeadProfile: {
                isNot: null
              }
            }
          ]
        }
      ]
    },
    include: teamLeadUserInclude,
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }]
  });

  if (matches.length > 1) {
    throw new Error(
      [
        `Teamlead locator is ambiguous: ${locator}`,
        ...matches.map((teamLead) => `- ${formatTeamLead(teamLead)}`),
        'Use telegramId instead of username, or run npm run reconcile:known-users first.'
      ].join('\n')
    );
  }

  return matches[0] ?? null;
};

const run = async () => {
  if (!fromLocator || !toLocator) {
    throw new Error(
      [
        'Usage: npm run teamleads:reassign -- --from=@old --to=@new [--include-inactive-source-links] [--only-with-target-history] [--active-updated-since=ISO_DATE] [--apply]',
        '',
        '--only-with-target-history moves only creators that already have any historical link to the target teamlead.'
      ].join('\n')
    );
  }

  if (fromLocator === toLocator) {
    throw new Error('--from and --to must be different teamleads');
  }

  const [fromTeamLead, toTeamLead] = await Promise.all([
    findTeamLead(fromLocator, { requireActive: false }),
    findTeamLead(toLocator, { requireActive: true })
  ]);

  if (!fromTeamLead) {
    throw new Error(`Source teamlead not found: ${fromLocator}`);
  }

  if (!toTeamLead) {
    throw new Error(`Target active teamlead not found: ${toLocator}`);
  }

  const links = await prisma.creatorTeamLeadLink.findMany({
    where: {
      teamLeadUserId: fromTeamLead.id,
      ...(includeInactiveSourceLinks
        ? {}
        : {
            isActive: true
          }),
      ...(activeUpdatedSince
        ? {
            updatedAt: {
              gte: activeUpdatedSince
            }
          }
        : {}),
      creator: {
        is: {
          isActive: true,
          AND: [
            {
              creatorAssignments: {
                none: {
                  teamLeadUserId: toTeamLead.id,
                  isActive: true
                }
              }
            },
            ...(onlyWithTargetHistory
              ? [
                  {
                    creatorAssignments: {
                      some: {
                        teamLeadUserId: toTeamLead.id
                      }
                    }
                  }
                ]
              : [])
          ],
          OR: [
            {
              role: UserRole.CREATOR
            },
            {
              creatorProfile: {
                isNot: null
              }
            }
          ]
        }
      }
    },
    include: {
      creator: {
        include: {
          creatorProfile: true
        }
      }
    },
    orderBy: {
      updatedAt: 'asc'
    }
  });

  console.log(`Teamlead reassignment. Mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`From: ${formatTeamLead(fromTeamLead)}`);
  console.log(`To:   ${formatTeamLead(toTeamLead)}`);
  console.log(`Include inactive source links: ${includeInactiveSourceLinks ? 'yes' : 'no'}`);
  console.log(`Only with target history: ${onlyWithTargetHistory ? 'yes' : 'no'}`);
  console.log(`Active updated since: ${activeUpdatedSince ? activeUpdatedSince.toISOString() : 'not set'}`);
  console.log(`Creators to move: ${links.length}`);

  for (const link of links) {
    console.log(
      `- ${formatCreatorDisplayName(link.creator)} (telegramId=${link.creator.telegramId}); sourceActive=${
        link.isActive
      }; sourceUpdatedAt=${link.updatedAt.toISOString()}`
    );
  }

  if (!links.length) {
    return;
  }

  if (!apply) {
    console.log('\nNo changes written. Re-run with --apply when the plan is correct.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const link of links) {
      await tx.creatorTeamLeadLink.updateMany({
        where: {
          creatorUserId: link.creatorUserId,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      await tx.creatorTeamLeadLink.upsert({
        where: {
          creatorUserId_teamLeadUserId: {
            creatorUserId: link.creatorUserId,
            teamLeadUserId: toTeamLead.id
          }
        },
        create: {
          creatorUserId: link.creatorUserId,
          teamLeadUserId: toTeamLead.id,
          isActive: true
        },
        update: {
          isActive: true
        }
      });
    }
  });

  console.log(`Moved creators: ${links.length}`);
};

run()
  .catch((error) => {
    console.error('Teamlead reassignment failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
