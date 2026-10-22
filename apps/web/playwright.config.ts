import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout du back-office, sur un environnement DÉDIÉ : base
 * `gestion_traiteurs_e2e` recréée et seedée à chaque lancement (garde-fou sur le nom),
 * base Redis n° 1, API sur le port 3100 et back-office sur le port 3101. La base de
 * démonstration et les serveurs de développement (3000, 3001) ne sont jamais utilisés.
 * Prérequis : services Docker démarrés (`pnpm docker:up`).
 */
const API_PORT = 3100;
const WEB_PORT = 3101;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

/** Variable de l'API : environnement (CI), sinon apps/api/.env (poste de développement). */
function apiEnv(key: string): string {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;
  const file = path.join(__dirname, '../api/.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = new RegExp(`^${key}=(.*)$`).exec(line.trim());
      if (match?.[1]) return match[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error(`${key} introuvable (environnement ou apps/api/.env)`);
}

/** Même serveur PostgreSQL, base dédiée aux parcours. */
const e2eDatabase = new URL(apiEnv('DATABASE_URL'));
e2eDatabase.pathname = '/gestion_traiteurs_e2e';
/** Même serveur Redis, base n° 1 : le worker de développement ne prend jamais ces tâches. */
const e2eRedis = new URL(apiEnv('REDIS_URL'));
e2eRedis.pathname = '/1';

// Lu par les parcours (préparation des données par l'API)
process.env.E2E_API_URL = `${API_URL}/api/v1`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Large : une connexion limitée en débit attend jusqu'à une minute avant de réessayer
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // E2E_BROWSER_CHANNEL=chrome : utilise le Chrome installé au lieu du Chromium de Playwright
        ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
      },
    },
  ],
  webServer: [
    {
      // Base e2e recréée et seedée, puis API compilée et lancée
      command: 'pnpm --filter @traiteur/api e2e:server',
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        DATABASE_URL: e2eDatabase.toString(),
        REDIS_URL: e2eRedis.toString(),
        PORT: String(API_PORT),
        CORS_ORIGINS: WEB_URL,
        PUBLIC_WEB_URL: WEB_URL,
      },
    },
    {
      // Version compilée (rapide et proche de la production), dans un dossier de build séparé
      command: `pnpm --filter @traiteur/web exec next build && pnpm --filter @traiteur/web exec next start -p ${WEB_PORT}`,
      url: `${WEB_URL}/admin/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        PUBLIC_API_URL: `${API_URL}/api/v1`,
        API_INTERNAL_URL: `${API_URL}/api/v1`,
        PUBLIC_MEDIA_URL: apiEnv('S3_PUBLIC_URL'),
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
