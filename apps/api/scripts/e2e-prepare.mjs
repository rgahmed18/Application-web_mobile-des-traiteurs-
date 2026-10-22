/**
 * Base dédiée aux parcours e2e (Playwright) : recréée à chaque lancement, migrée puis seedée.
 * Garde-fou : le nom de la base doit se terminer par « _e2e » — la base de démonstration et la
 * base de développement ne peuvent jamais être effacées par les parcours.
 *
 * Lancé par Playwright (webServer de l'API, voir apps/web/playwright.config.ts) avec
 * DATABASE_URL pointant sur la base e2e.
 */
import { execSync } from 'node:child_process';

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL est requis');
const target = new URL(url);
const database = target.pathname.replace(/^\//, '');
if (!database.endsWith('_e2e')) {
  throw new Error(`Refus de préparer la base « ${database} » : son nom doit finir par _e2e`);
}

// Création de la base si besoin (connexion à la base d'administration « postgres »)
const admin = new URL(url);
admin.pathname = '/postgres';
admin.search = '';
const server = new pg.Client({ connectionString: admin.toString() });
await server.connect();
const exists = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
if (exists.rowCount === 0) await server.query(`CREATE DATABASE "${database}"`);
await server.end();

// Schéma vidé, puis migrations et seed de démonstration
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await client.end();

const run = (command) => execSync(command, { stdio: 'inherit', env: process.env });
run('pnpm exec prisma migrate deploy');
run('pnpm exec prisma db seed');
console.log(`✓ Base e2e « ${database} » prête`);
