import { expect, test } from '@playwright/test';

import { login, MANAGER } from './helpers';

test.describe('Connexion au back-office', () => {
  test('redirige vers la connexion sans session', async ({ page }) => {
    await page.goto('/admin/catalog/dishes');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('refuse un mot de passe erroné sans révéler le compte', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Téléphone ou email').fill(MANAGER.phone);
    await page.getByRole('textbox', { name: 'Mot de passe' }).fill('MauvaisMotDePasse1!');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText(/identifiants incorrects/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('connexion, session conservée au rechargement, puis déconnexion', async ({
    page,
    context,
  }) => {
    await login(page);

    // Le refresh token est dans un cookie httpOnly, jamais lisible par la page
    const cookie = (await context.cookies()).find((item) => item.name === 'gt_refresh');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/session' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('gt_refresh');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();

    await page.getByRole('button', { name: 'Mon compte' }).click();
    await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
