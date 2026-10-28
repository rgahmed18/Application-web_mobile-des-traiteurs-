import { expect, test } from '@playwright/test';

import { login, MANAGER, PLATFORM_URL } from './helpers';

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
    // Marque blanche : le nom du traiteur, jamais celui de la plateforme
    await expect(page.getByTestId('traiteur-brand')).toHaveText(/Dar Diafa Traiteur/);
    await expect(page.getByTestId('super-admin-badge')).toHaveCount(0);

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

test.describe('Espaces : le traiteur vient de l’adresse', () => {
  test('page de connexion à la marque du traiteur du sous-domaine', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.getByTestId('space-brand')).toHaveText(/Dar Diafa Traiteur/);
    await expect(page.getByText('Espace de gestion de Dar Diafa Traiteur.')).toBeVisible();
  });

  test('adresse inconnue : « Espace introuvable », sans rien révéler', async ({ page }) => {
    const port = new URL(PLATFORM_URL).port;
    await page.goto(`http://traiteur-inconnu.localhost:${port}/admin/login`);
    await expect(page.getByTestId('space-not-found')).toContainText('Espace introuvable');
    await expect(page.getByLabel('Téléphone ou email')).toHaveCount(0);
  });

  test('le personnel d’un traiteur n’entre pas par l’adresse de la console', async ({ page }) => {
    await page.goto(`${PLATFORM_URL}/admin/login`);
    await expect(page.getByTestId('space-brand')).toHaveText('Console plateforme');
    // Pas de code SMS sur la console : mot de passe et double authentification seulement
    await expect(page.getByRole('tab', { name: 'Code par SMS' })).toHaveCount(0);
    await page.getByLabel('Téléphone ou email').fill(MANAGER.phone);
    await page.getByRole('textbox', { name: 'Mot de passe' }).fill(MANAGER.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(
      page.getByText(/Ce compte n’a pas accès à la console de la plateforme/).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
