import { expect, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login, uniqueSuffix } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/** Jour civil à Casablanca, dans `offset` jours. */
function casablancaDay(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
}

test('livreur invité, activé, affecté : il ne voit que sa mission, sans aucun prix', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const suffix = uniqueSuffix();
  const driverPhone = `07${String(Date.now()).slice(-8)}`;
  const password = 'Livreur-2026!';

  // ─── Commande confirmée créée par l'API (le parcours de commande a son propre test) ───
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const client = await api.post(`${API}/clients`, {
    headers,
    data: {
      phone: `06${String(Date.now() + 7).slice(-8)}`,
      firstName: 'Nadia',
      lastName: `Mission ${suffix}`,
      email: null,
      locale: 'fr',
      tags: [],
      internalNotes: null,
      address: null,
    },
  });
  const clientId = ((await client.json()) as { id: string }).id;
  const created = await api.post(`${API}/orders`, {
    headers,
    data: {
      clientId,
      eventType: 'WEDDING',
      eventDate: casablancaDay(150 + (Date.now() % 100)),
      startTime: '20:00',
      endTime: '23:30',
      endsNextDay: false,
      guestCount: 150,
      venueName: 'Salle Les Jasmins',
      venueAddress: '8, avenue Hassan II',
      city: 'Casablanca',
      notes: null,
      internalNotes: 'Note interne à ne jamais montrer',
      status: 'CONFIRMED',
      forceAvailability: true,
      lines: [
        {
          itemType: 'CUSTOM',
          label: { fr: 'Menu mariage', ar: 'قائمة العرس' },
          quantity: 150,
          unitPrice: 25_000,
          taxRateBps: 2000,
          perPerson: true,
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const order = (await created.json()) as { id: string; reference: string };

  // ─── Invitation du livreur depuis l'onglet Équipe ───
  await login(page);
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: 'Inviter un membre' }).click();
  const invite = page.getByRole('dialog');
  await invite.getByLabel('Téléphone').fill(driverPhone);
  await invite.getByLabel('Prénom').fill('Anas');
  await invite.getByLabel('Nom', { exact: true }).fill(`Livreur ${suffix}`);
  await invite.getByRole('radio', { name: /Livreur/ }).click();
  await invite.getByRole('button', { name: 'Enregistrer' }).click();
  const linkInput = page.getByTestId('invitation-link-url');
  await expect(linkInput).toHaveValue(/\/invitation\/[A-Za-z0-9_-]{43}$/);
  const link = await linkInput.inputValue();
  await page.getByRole('button', { name: 'Terminé' }).click();

  // ─── Activation par le livreur (autre navigateur) ───
  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const activation = await driver.goto(link);
  expect(activation?.headers()['x-robots-tag']).toContain('noindex');
  await driver.getByLabel('Nouveau mot de passe').fill(password);
  await driver.getByLabel('Confirmez le mot de passe').fill(password);
  await driver.getByRole('button', { name: 'Activer mon accès' }).click();
  await expect(driver.getByRole('heading', { name: 'Accès activé' })).toBeVisible();

  // ─── Affectation sur la fiche commande ───
  await page.goto(`/admin/orders/${order.id}`);
  const personnel = page.getByTestId('personnel-card');
  await personnel.getByRole('button', { name: 'Affecter' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Membre', { exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`Livreur ${suffix}`) }).click();
  await dialog.getByLabel('Rôle sur l’événement').click();
  await page.getByRole('option', { name: 'Chauffeur' }).click();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Affectation enregistrée')).toBeVisible();
  await expect(personnel.getByTestId('assignments-list')).toContainText(`Livreur ${suffix}`);

  // ─── Connexion du livreur : sa mission seulement, aucun prix ───
  await driver.getByRole('link', { name: 'Se connecter' }).click();
  await expect(driver.getByLabel('Téléphone ou email')).toHaveValue(/\+?212?7?\d+/);
  await driver.getByRole('textbox', { name: 'Mot de passe' }).fill(password);
  await driver.getByRole('button', { name: 'Se connecter' }).click();
  const missions = driver.getByTestId('missions-list');
  await expect(missions).toBeVisible();
  await expect(missions.getByRole('listitem')).toHaveCount(1);
  await expect(missions).toContainText(order.reference);
  await expect(driver.locator('main')).not.toContainText('MAD');

  await missions.getByRole('link').first().click();
  const detail = driver.getByTestId('mission-detail');
  await expect(detail).toContainText('Salle Les Jasmins');
  await expect(detail.getByTestId('mission-content')).toContainText('Menu mariage');
  await expect(detail).not.toContainText('MAD');
  await expect(detail).not.toContainText('Note interne');
  await expect(detail.getByRole('link', { name: 'Ouvrir dans Google Maps' })).toHaveAttribute(
    'href',
    /google\.com\/maps/,
  );
  await detail.getByRole('button', { name: 'Confirmer ma présence' }).click();
  await expect(driver.getByText('Présence confirmée')).toBeVisible();

  // Pas d'accès aux commandes ni au tableau de bord : retour à ses missions
  await driver.goto('/admin');
  await expect(driver).toHaveURL(/\/admin\/missions$/);
  await driverContext.close();
  await api.dispose();
});
