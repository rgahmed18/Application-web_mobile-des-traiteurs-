import { type APIRequestContext, expect, type Page } from '@playwright/test';

/** Gérant du traiteur de démonstration (prisma/seed.ts). */
export const MANAGER = { phone: '0600000002', password: 'Password123!' };

/**
 * Connexion par le formulaire. Les parcours enchaînent de nombreuses connexions depuis la même
 * adresse : si la limitation de débit répond « Trop de tentatives », attente puis nouvel essai.
 */
export async function login(page: Page, account = MANAGER): Promise<void> {
  const welcome = page.getByRole('heading', { level: 1, name: /^Bonjour/ });
  const throttled = page.getByText(/Trop de tentatives/);
  for (let attempt = 1; ; attempt += 1) {
    await page.goto('/admin/login');
    await page.getByLabel('Téléphone ou email').fill(account.phone);
    await page.getByRole('textbox', { name: 'Mot de passe' }).fill(account.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(welcome.or(throttled).first()).toBeVisible();
    if (!(await throttled.isVisible()) || attempt === 4) break;
    await page.waitForTimeout(20_000);
  }
  await expect(welcome).toBeVisible();
}

/** Suffixe unique : les parcours peuvent être rejoués sur la même base. */
export function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

/**
 * Connexion à l'API (préparation des données d'un parcours) : réponse vérifiée, et attente
 * puis nouvel essai si la limitation de débit des connexions répond 429 (les parcours
 * enchaînent de nombreuses connexions depuis la même adresse).
 */
export async function apiLogin(
  api: APIRequestContext,
  account = MANAGER,
): Promise<{ Authorization: string }> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await api.post(`${API}/auth/login`, {
      data: { traiteurSlug: 'dar-diafa', identifier: account.phone, password: account.password },
    });
    if (response.status() === 429 && attempt < 4) {
      const wait = Number(response.headers()['retry-after'] ?? '20');
      await new Promise((resolve) =>
        setTimeout(resolve, (Number.isFinite(wait) ? wait : 20) * 1000),
      );
      continue;
    }
    expect(response.status(), `connexion API : ${await response.text()}`).toBe(200);
    const { accessToken } = (await response.json()) as { accessToken: string };
    return { Authorization: `Bearer ${accessToken}` };
  }
}
