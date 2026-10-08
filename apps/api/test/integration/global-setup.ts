import { execSync } from 'node:child_process';

import { Client } from 'pg';

import { getTestDatabaseUrl } from './test-database-url';

/** Recrée le schéma de la base de test puis applique toutes les migrations. */
export default async function globalSetup(): Promise<void> {
  const url = getTestDatabaseUrl();

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
