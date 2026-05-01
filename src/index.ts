import { createBot } from './bot/create-bot';
import { container } from './container';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startScheduler } from './jobs/scheduler';

const bootstrap = async () => {
  await container.services.fileStorageService.ensureStorage();
  await prisma.$connect();

  const bot = createBot();
  const scheduler = startScheduler(bot);

  await bot.launch();
  logger.info('Bot started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down bot');
    scheduler.stop();
    bot.stop(signal);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

bootstrap().catch(async (error) => {
  logger.error({ error }, 'Failed to bootstrap application');
  await prisma.$disconnect();
  process.exit(1);
});
