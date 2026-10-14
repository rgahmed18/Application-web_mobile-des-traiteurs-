import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

/** Client Prisma des commandes en ligne (hors Nest), sur DATABASE_URL. */
export function cliPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL est requis.');
    process.exit(1);
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
