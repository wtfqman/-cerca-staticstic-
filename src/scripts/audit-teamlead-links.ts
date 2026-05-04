import { prisma } from '../lib/prisma';
import { formatCreatorDisplayName, formatTeamLeadDisplayName } from '../utils/formatters';

type Link = Awaited<ReturnType<typeof loadLinks>>[number];

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

const restorePrevious = hasFlag('--restore-previous');
const apply = hasFlag('--apply');
const sinceArg = getArgValue('--since');
const creatorTelegramId = getArgValue('--creator-telegram-id');
const since = sinceArg ? new Date(sinceArg) : null;

if (sinceArg && Number.isNaN(since?.getTime())) {
  console.error(`Invalid --since value: ${sinceArg}`);
  process.exit(1);
}

function formatDate(value: Date) {
  return value.toISOString();
}

function formatCreator(link: Pick<Link, 'creator'>) {
  return `${formatCreatorDisplayName(link.creator)} (telegramId=${link.creator.telegramId})`;
}

function formatTeamLead(link: Pick<Link, 'teamLead'>) {
  return `${formatTeamLeadDisplayName(link.teamLead)} (telegramId=${link.teamLead.telegramId})`;
}

async function loadLinks() {
  return prisma.creatorTeamLeadLink.findMany({
    where: creatorTelegramId
      ? {
          creator: {
            telegramId: creatorTelegramId
          }
        }
      : undefined,
    include: {
      creator: {
        include: {
          creatorProfile: true
        }
      },
      teamLead: {
        include: {
          teamLeadProfile: true
        }
      }
    },
    orderBy: [{ creatorUserId: 'asc' }, { createdAt: 'asc' }]
  });
}

const sortByNewestActivity = (left: Link, right: Link) =>
  right.updatedAt.getTime() - left.updatedAt.getTime() ||
  right.createdAt.getTime() - left.createdAt.getTime();

const groupByCreator = (links: Link[]) => {
  const grouped = new Map<string, Link[]>();

  for (const link of links) {
    const bucket = grouped.get(link.creatorUserId) ?? [];
    bucket.push(link);
    grouped.set(link.creatorUserId, bucket);
  }

  return grouped;
};

const getCurrentActiveLink = (links: Link[]) =>
  links
    .filter((link) => link.isActive)
    .sort(sortByNewestActivity)[0] ?? null;

const getPreviousInactiveLink = (links: Link[], currentActive: Link | null) =>
  links
    .filter((link) => !link.isActive && link.teamLeadUserId !== currentActive?.teamLeadUserId)
    .sort(sortByNewestActivity)[0] ?? null;

const isInRestoreWindow = (currentActive: Link | null, activeLinks: Link[]) => {
  if (!since) {
    return true;
  }

  return activeLinks.length > 1 || Boolean(currentActive && currentActive.updatedAt >= since);
};

const run = async () => {
  const links = await loadLinks();
  const byCreator = groupByCreator(links);
  const activeByTeamLead = new Map<string, Link[]>();
  const restoreCandidates: Array<{
    creatorUserId: string;
    currentActive: Link;
    previous: Link;
    activeLinks: Link[];
  }> = [];
  const suspicious: string[] = [];

  for (const creatorLinks of byCreator.values()) {
    const activeLinks = creatorLinks.filter((link) => link.isActive);
    const currentActive = getCurrentActiveLink(creatorLinks);
    const previous = getPreviousInactiveLink(creatorLinks, currentActive);

    if (currentActive) {
      const bucket = activeByTeamLead.get(currentActive.teamLeadUserId) ?? [];
      bucket.push(currentActive);
      activeByTeamLead.set(currentActive.teamLeadUserId, bucket);
    }

    if (activeLinks.length !== 1 || previous) {
      const creatorLabel = creatorLinks[0] ? formatCreator(creatorLinks[0]) : 'unknown creator';
      const currentLabel = currentActive ? formatTeamLead(currentActive) : 'NO ACTIVE TEAMLEAD';
      const previousLabel = previous ? formatTeamLead(previous) : 'NO HISTORY';
      suspicious.push(
        [
          `- ${creatorLabel}`,
          `  activeLinks=${activeLinks.length}`,
          `current=${currentLabel}`,
          `currentUpdatedAt=${currentActive ? formatDate(currentActive.updatedAt) : '-'}`,
          `previous=${previousLabel}`,
          `previousUpdatedAt=${previous ? formatDate(previous.updatedAt) : '-'}`
        ].join(', ')
      );
    }

    if (
      restorePrevious &&
      currentActive &&
      previous &&
      isInRestoreWindow(currentActive, activeLinks)
    ) {
      restoreCandidates.push({
        creatorUserId: currentActive.creatorUserId,
        currentActive,
        previous,
        activeLinks
      });
    }
  }

  console.log(`Teamlead link audit. Links=${links.length}, creatorsWithLinks=${byCreator.size}`);

  console.log('\nACTIVE GROUPS');
  for (const [, groupLinks] of [...activeByTeamLead.entries()].sort((left, right) =>
    formatTeamLead(left[1][0]).localeCompare(formatTeamLead(right[1][0]))
  )) {
    const teamLead = groupLinks[0];
    console.log(`\n${formatTeamLead(teamLead)} - creators=${groupLinks.length}`);

    for (const link of groupLinks.sort((left, right) => formatCreator(left).localeCompare(formatCreator(right)))) {
      console.log(`  - ${formatCreator(link)}; activeUpdatedAt=${formatDate(link.updatedAt)}`);
    }
  }

  console.log('\nSUSPICIOUS OR HISTORICAL LINKS');
  if (suspicious.length) {
    console.log(suspicious.join('\n'));
  } else {
    console.log('No suspicious or historical links found.');
  }

  if (!restorePrevious) {
    console.log('\nDry audit only. To restore previous inactive links, run with --restore-previous. Add --apply to write.');
    return;
  }

  console.log('\nRESTORE PREVIOUS PLAN');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Since: ${since ? since.toISOString() : 'not set'}`);

  if (!restoreCandidates.length) {
    console.log('No restore candidates found.');
    return;
  }

  for (const candidate of restoreCandidates) {
    console.log(
      [
        `- ${formatCreator(candidate.currentActive)}`,
        `from=${formatTeamLead(candidate.currentActive)}`,
        `to=${formatTeamLead(candidate.previous)}`,
        `currentUpdatedAt=${formatDate(candidate.currentActive.updatedAt)}`,
        `previousUpdatedAt=${formatDate(candidate.previous.updatedAt)}`
      ].join(', ')
    );
  }

  if (!apply) {
    console.log('\nNo changes written. Re-run with --apply when the plan is correct.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const candidate of restoreCandidates) {
      await tx.creatorTeamLeadLink.updateMany({
        where: {
          creatorUserId: candidate.creatorUserId,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      await tx.creatorTeamLeadLink.update({
        where: {
          id: candidate.previous.id
        },
        data: {
          isActive: true
        }
      });
    }
  });

  console.log(`Restored creators: ${restoreCandidates.length}`);
};

run()
  .catch((error) => {
    console.error('Teamlead link audit failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
