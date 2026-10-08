import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout du back-office. Prérequis : services Docker démarrés
 * (`pnpm docker:up`), base migrée et seedée (`pnpm db:migrate && pnpm db:seed`).
 * L'API et le back-office sont lancés automatiquement s'ils ne tournent pas déjà.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
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
      command: 'pnpm --filter @traiteur/api dev',
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @traiteur/web dev',
      url: `${WEB_URL}/admin/login`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
