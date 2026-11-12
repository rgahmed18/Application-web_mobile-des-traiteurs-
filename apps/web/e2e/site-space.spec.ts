import { expect, type Page, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';
import { gotoSignedIn, signUpOnSite } from './site-helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

function inDays(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** Demande envoyée depuis le site (un service du catalogue) ; retourne l'identifiant. */
async function sendRequest(page: Page, days: number): Promise<string> {
  await gotoSignedIn(page, '/catalogue?onglet=service');
  await page
    .getByTestId('catalog-card')
    .filter({ hasText: 'Décoration florale de la salle' })
    .getByTestId('add-to-cart')
    .click();
  await gotoSignedIn(page, '/demande');
  const wizard = page.getByTestId('request-wizard');
  await wizard.getByLabel('Type d’événement').click();
  await page.getByRole('option', { name: 'Mariage' }).click();
  await wizard.getByLabel('Date').fill(inDays(days));
  await wizard.getByLabel('Heure de début').fill('20:00');
  await wizard.getByLabel('Nombre d’invités').fill('60');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByLabel('Ville').fill('Salé');
  await wizard.getByLabel('Adresse', { exact: true }).fill('5 rue des Jasmins');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page).toHaveURL(/\/espace\/demandes\/[0-9a-f-]{36}$/);
  return page.url().split('/').at(-1) ?? '';
}

test('devis envoyé par le traiteur, accepté dans l’espace client ; historique des deux côtés', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const lastName = `Espace${Date.now().toString(36).slice(-4)}`;
  await signUpOnSite(page, { firstName: 'Amal', lastName });
  const orderId = await sendRequest(page, 75);
  const order = page.getByTestId('client-order');
  await expect(order.getByTestId('client-order-status')).toHaveText('En attente');
  await expect(order.getByTestId('client-order-history')).toContainText('par vous');

  // Le traiteur prépare et envoie le devis
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const quote = (await (
    await api.post(`${API}/orders/${orderId}/quotes`, { headers, data: {} })
  ).json()) as { id: string };
  expect((await api.post(`${API}/quotes/${quote.id}/send`, { headers })).status()).toBe(200);

  // Le client le voit à traiter, l'ouvre et l'accepte depuis son espace
  await page.goto('/espace');
  const toAnswer = page.getByTestId('dashboard-quotes');
  await expect(toAnswer).toContainText('À traiter');
  await toAnswer.getByTestId('client-quote-row').click();
  const view = page.getByTestId('quote-view');
  await expect(view.getByTestId('public-quote-status')).toHaveText('En attente de votre réponse');
  await view.getByRole('button', { name: 'Accepter le devis' }).click();
  await view.getByLabel('Votre nom complet').fill(`Amal ${lastName}`);
  await view.getByLabel(/J’accepte ce devis/).check();
  await view.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(view.getByTestId('public-quote-outcome')).toContainText(
    'Votre accord est enregistré',
  );

  // Commande confirmée, historique côté client
  await page.goto(`/espace/demandes/${orderId}`);
  await expect(order.getByTestId('client-order-status')).toHaveText('Confirmée');
  const history = order.getByTestId('client-order-history');
  await expect(history).toContainText('Devis envoyé');
  await expect(history).toContainText('par le traiteur');
  await expect(history).toContainText('Confirmée');

  // Côté traiteur : accord en ligne tracé dans la commande
  const staff = await browser.newPage();
  await login(staff);
  await staff.goto(`/admin/orders/${orderId}`);
  await expect(staff.getByTestId('order-status')).toHaveText('Confirmée');
  await expect(staff.getByTestId('quotes-card')).toContainText(
    `Accepté en ligne par Amal ${lastName}`,
  );
  await expect(staff.getByTestId('online-request-badge')).toBeVisible();
  await staff.close();
  await api.dispose();
});

test('espace client : annulation d’une demande en attente, profil et adresses', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpOnSite(page, { firstName: 'Ilyas', lastName: 'Sbai' });
  const orderId = await sendRequest(page, 80);
  const order = page.getByTestId('client-order');
  await order.getByRole('button', { name: 'Annuler la demande' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler la demande' }).click();
  await expect(order.getByTestId('client-order-status')).toHaveText('Annulée');
  await page.goto('/espace/demandes');
  await expect(page.getByTestId('client-orders')).toContainText('Annulée');

  await page.getByRole('link', { name: 'Profil' }).click();
  const profile = page.getByTestId('client-profile');
  await profile.getByLabel('Nom', { exact: true }).fill('Sbai-Alaoui');
  await profile.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Coordonnées enregistrées.')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une adresse' }).click();
  await page.getByLabel('Nom (ex. Maison)').fill('Maison');
  await page.getByLabel('Ville').fill('Rabat');
  await page.getByLabel('Adresse', { exact: true }).fill('8 avenue Mohammed V');
  await page.getByRole('button', { name: 'Enregistrer l’adresse' }).click();
  await expect(page.getByTestId('client-addresses')).toContainText('8 avenue Mohammed V');
});
