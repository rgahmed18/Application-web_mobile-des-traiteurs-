import { createHmac } from 'node:crypto';

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

/** Adresse de la console de la plateforme (le back-office des traiteurs est sur leur sous-domaine). */
export const PLATFORM_URL = process.env.E2E_PLATFORM_URL ?? 'http://localhost:3101';

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
      data: {
        traiteurSlug: 'dar-diafa',
        identifier: account.phone,
        password: account.password,
        space: 'backoffice',
      },
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

/** Code TOTP (RFC 6238, SHA-1, 30 s, 6 chiffres) d'une clé base32, pour un pas décalé. */
export function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/\s/g, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const start = (hmac[hmac.length - 1] ?? 0) & 15;
  return String((hmac.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
