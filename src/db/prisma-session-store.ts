import { prisma } from '../lib/prisma';

export class PrismaSessionStore<TSession extends object> {
  async get(key: string): Promise<TSession | undefined> {
    const record = await prisma.botSession.findUnique({
      where: { key }
    });

    return (record?.data as TSession | undefined) ?? undefined;
  }

  async set(key: string, value: TSession): Promise<void> {
    const normalized = JSON.parse(JSON.stringify(value));

    await prisma.botSession.upsert({
      where: { key },
      create: {
        key,
        data: normalized
      },
      update: {
        data: normalized
      }
    });
  }

  async delete(key: string): Promise<void> {
    await prisma.botSession.deleteMany({
      where: { key }
    });
  }
}
