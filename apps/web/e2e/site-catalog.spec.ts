import { expect, test } from '@playwright/test';

import { signUpOnSite } from './site-helpers';

test('visiteur : accueil, catalogue filtré, prix TTC, « ma demande », sur téléphone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const home = page.getByTestId('site-home');
  await expect(home.getByRole('heading', { level: 1 })).toContainText('Dar Diafa');
  await home.getByRole('link', { name: 'Voir le catalogue' }).click();

  const catalog = page.getByTestId('site-catalog');
  await expect(catalog.getByTestId('catalog-card').first()).toBeVisible();
  await expect(catalog).toContainText('Formule Mariage Prestige');
  await expect(catalog).toContainText(/MAD \/ personne/);
  // Jamais de stock ni de prix HT sur le site
  await expect(catalog).not.toContainText(/\bstock\b|\bHT\b/i);
  // Rien ne déborde sur un écran de téléphone
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Filtre par type d'événement, gardé dans l'adresse
  await catalog.getByRole('combobox', { name: 'Événement' }).click();
  await page.getByRole('option', { name: 'Mariage' }).click();
  await expect(page).toHaveURL(/type=WEDDING/);
  await expect(catalog).toContainText('Formule Mariage Prestige');

  // Menu ajouté à la demande, puis un service en quantité
  const wedding = catalog
    .getByTestId('catalog-card')
    .filter({ hasText: 'Formule Mariage Prestige' });
  await wedding.getByTestId('add-to-cart').click();
  await expect(wedding.getByTestId('in-cart')).toBeVisible();
  await catalog.getByRole('tab', { name: /Services/ }).click();
  const decoration = catalog
    .getByTestId('catalog-card')
    .filter({ hasText: 'Décoration florale de la salle' });
  await decoration.getByRole('link', { name: 'Décoration florale de la salle' }).click();
  const item = page.getByTestId('catalog-item');
  await item.getByLabel('Quantité').fill('2');
  await item.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('site-nav-request')).toHaveText('Ma demande (2)');

  await page.getByTestId('site-nav-request').click();
  const review = page.getByTestId('cart-review');
  await expect(review.getByTestId('cart-line')).toHaveCount(2);
  await expect(review.getByLabel('Quantité : Décoration florale de la salle')).toHaveValue('2');
  await expect(page.getByRole('link', { name: 'Se connecter pour envoyer' })).toHaveAttribute(
    'href',
    '/connexion?suite=%2Fdemande',
  );
  // Gardée sur l'appareil : retrouvée après rechargement, sans donnée personnelle
  await page.reload();
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  const stored = await page.evaluate(() => window.localStorage.getItem('gt-demande:dar-diafa'));
  for (const line of JSON.parse(stored ?? '[]') as Record<string, unknown>[]) {
    expect(Object.keys(line).sort()).toEqual(['id', 'kind', 'quantity']);
  }
});

test('catalogue en arabe ; « ma demande » vidée à la déconnexion', async ({ page, context }) => {
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'ar', url: 'http://dar-diafa.localhost:3101' },
  ]);
  await page.goto('/catalogue');
  const catalog = page.getByTestId('site-catalog');
  await expect(catalog.getByRole('tab', { name: /القوائم/ })).toBeVisible();
  await expect(catalog).toContainText('د.م.');

  await context.clearCookies();
  await signUpOnSite(page, { firstName: 'Imane', lastName: 'Berrada' });
  await page.goto('/catalogue');
  await page.getByTestId('catalog-card').first().getByTestId('add-to-cart').click();
  await expect(page.getByTestId('site-nav-request')).toHaveText('Ma demande (1)');
  await page.goto('/espace');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByTestId('site-nav-request')).toHaveText('Ma demande');
  expect(await page.evaluate(() => window.localStorage.getItem('gt-demande:dar-diafa'))).toBeNull();
});
