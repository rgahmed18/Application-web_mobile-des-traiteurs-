import { expect, test } from '@playwright/test';

import { login } from './helpers';
import { gotoSignedIn, signUpOnSite } from './site-helpers';

/** Jour civil à Casablanca, dans `days` jours (AAAA-MM-JJ). */
function inDays(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

test('demande en ligne : 4 étapes, disponibilité, estimation, reçue « En attente » au back-office', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const lastName = `Demande${Date.now().toString(36).slice(-4)}`;
  await signUpOnSite(page, { firstName: 'Hajar', lastName });

  // Choix dans le catalogue : la formule de mariage et un service
  await gotoSignedIn(page, '/catalogue');
  const catalog = page.getByTestId('site-catalog');
  await catalog
    .getByTestId('catalog-card')
    .filter({ hasText: 'Formule Mariage Prestige' })
    .getByTestId('add-to-cart')
    .click();
  await catalog.getByRole('tab', { name: /Services/ }).click();
  await catalog
    .getByTestId('catalog-card')
    .filter({ hasText: 'Décoration florale de la salle' })
    .getByTestId('add-to-cart')
    .click();
  await page.getByTestId('site-nav-request').click();

  // 1. Événement : la date indique « Disponible », sans aucun chiffre de capacité
  const wizard = page.getByTestId('request-wizard');
  await wizard.getByLabel('Type d’événement').click();
  await page.getByRole('option', { name: 'Mariage' }).click();
  await wizard.getByLabel('Date').fill(inDays(45));
  await wizard.getByLabel('Heure de début').fill('19:00');
  await wizard.getByLabel('Nombre d’invités').fill('150');
  await expect(wizard.getByTestId('request-step-event')).toContainText('Disponible');
  await wizard.getByRole('button', { name: 'Suivant' }).click();

  // 2. Choix : les deux éléments ; 3. Lieu
  await expect(wizard.getByTestId('cart-line')).toHaveCount(2);
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByLabel('Ville').fill('Rabat');
  await wizard.getByLabel('Adresse', { exact: true }).fill('12 avenue Hassan II');
  await wizard.getByLabel('Précisions pour le traiteur (facultatif)').fill('Entrée par le jardin');
  await wizard.getByRole('button', { name: 'Suivant' }).click();

  // 4. Récapitulatif : estimation TTC (450 MAD × 150 invités + décoration), puis envoi
  const summary = wizard.getByTestId('request-step-summary');
  await expect(summary).toContainText('Formule Mariage Prestige');
  await expect(wizard.getByTestId('request-estimate')).toContainText('MAD');
  await wizard.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByText(/Demande CMD-\d{4}-\d+ envoyée au traiteur/)).toBeVisible();
  // « Ma demande » est vidée après l'envoi
  await expect(page.getByTestId('site-nav-request')).toHaveText('Ma demande');

  // Le traiteur la reçoit « En attente », marquée « Demande en ligne »
  const staff = await browser.newPage();
  await login(staff);
  // Cloche : la nouvelle demande est signalée, lien vers la commande
  await staff.getByTestId('notification-bell').click();
  const notice = staff
    .getByTestId('notification-list')
    .getByRole('button', { name: new RegExp(`Nouvelle demande en ligne .* de Hajar ${lastName}`) });
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(staff).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  await expect(staff.getByTestId('online-request-badge')).toBeVisible();
  await staff.goto('/admin/orders');
  const row = staff.getByRole('link').filter({ hasText: lastName });
  await expect(row).toContainText('En attente');
  await expect(row.getByTestId('online-request-badge')).toBeVisible();
  await row.click();
  await expect(staff.getByTestId('order-status')).toHaveText('En attente');
  await expect(staff.getByText('Entrée par le jardin')).toBeVisible();
  await staff.close();
});
