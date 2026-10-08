import { expect, type Page } from '@playwright/test';

/** Gérant du traiteur de démonstration (prisma/seed.ts). */
export const MANAGER = { phone: '0600000002', password: 'Password123!' };

export async function login(page: Page, account = MANAGER): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Téléphone ou email').fill(account.phone);
  await page.getByRole('textbox', { name: 'Mot de passe' }).fill(account.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();
}

/** Suffixe unique : les parcours peuvent être rejoués sur la même base. */
export function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-6);
}
