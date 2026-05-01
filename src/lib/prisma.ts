import { PrismaClient } from '@prisma/client';

import { config } from '../config';
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: config.db.url
      }
    },
    log:
      config.app.env === 'development'
        ? [
            { emit: 'stdout', level: 'error' },
            { emit: 'stdout', level: 'warn' }
          ]
        : [{ emit: 'stdout', level: 'error' }]
  });

if (config.app.env !== 'production') {
  globalForPrisma.prisma = prisma;
}
