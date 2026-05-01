import { prisma } from '../lib/prisma';
import { UserRepository } from '../repositories/user.repository';
import {
  TeamLeadBootstrapService,
  type TeamLeadBootstrapInput
} from '../services/teamlead-bootstrap.service';
import { KNOWN_TEAM_LEADS } from './known-users';

const TEAM_LEADS: TeamLeadBootstrapInput[] = KNOWN_TEAM_LEADS;

const run = async () => {
  const service = new TeamLeadBootstrapService(new UserRepository());
  const results = await service.bootstrapTeamLeads(TEAM_LEADS);

  console.log(`Teamlead seed completed. Processed: ${results.length}`);

  for (const result of results) {
    const username = result.username ? `@${result.username}` : 'no username';
    console.log(
      `- ${result.action}: ${result.displayName} (${username}, telegramId=${result.telegramId}, userId=${result.userId})`
    );
  }
};

run()
  .catch((error) => {
    console.error('Teamlead seed failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
