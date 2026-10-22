import { expect, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login, uniqueSuffix } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';
/** Livreur du traiteur de démonstration (prisma/seed.ts). */
const DRIVER = { phone: '0600000004', password: 'Password123!' };

const casablancaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

test('encaissement à la livraison : déclaré par le livreur, remis à la caisse, reçu émis', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const suffix = uniqueSuffix();
  const today = casablancaToday();

  // ─── Commande du jour et affectation du livreur avec 1 500 MAD à encaisser (API) ───
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const client = await api.post(`${API}/clients`, {
    headers,
    data: {
      phone: `06${String(Date.now() + 11).slice(-8)}`,
      firstName: 'Karim',
      lastName: `Caisse ${suffix}`,
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
      eventType: 'BIRTHDAY',
      eventDate: today,
      startTime: '23:00',
      endTime: null,
      endsNextDay: false,
      guestCount: 10,
      venueName: null,
      venueAddress: '12, rue des Orangers',
      city: 'Casablanca',
      notes: null,
      internalNotes: null,
      status: 'CONFIRMED',
      forceAvailability: true,
      lines: [
        {
          itemType: 'CUSTOM',
          label: { fr: 'Buffet anniversaire', ar: 'بوفيه عيد ميلاد' },
          quantity: 10,
          unitPrice: 15_000,
          taxRateBps: 0,
          perPerson: true,
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const order = (await created.json()) as { id: string; reference: string };
  const staff = (await (await api.get(`${API}/staff`, { headers })).json()) as {
    id: string;
    phone: string;
  }[];
  const driverMember = staff.find((member) => member.phone === '+212600000004');
  expect(driverMember).toBeDefined();
  const assigned = await api.post(`${API}/orders/${order.id}/assignments`, {
    headers,
    data: {
      membershipId: driverMember?.id,
      staffRole: 'DRIVER',
      startsAt: `${today}T00:00`,
      endsAt: `${today}T23:59`,
      notes: null,
      force: true,
      cashToCollect: 150_000,
      cashMethod: 'CASH',
    },
  });
  expect(assigned.status()).toBe(201);
  const staffing = (await assigned.json()) as { assignments: { id: string; staffRole: string }[] };
  const missionId = staffing.assignments.find((item) => item.staffRole === 'DRIVER')?.id ?? '';

  // ─── Le livreur voit le montant sur cette mission et déclare « Encaissé » ───
  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  await driver.goto('/admin/login');
  await driver.getByLabel('Téléphone ou email').fill(DRIVER.phone);
  await driver.getByRole('textbox', { name: 'Mot de passe' }).fill(DRIVER.password);
  await driver.getByRole('button', { name: 'Se connecter' }).click();
  await expect(driver.getByTestId('missions-list')).toBeVisible();
  await driver.goto(`/admin/missions/${missionId}`);
  const cash = driver.getByTestId('mission-cash');
  await expect(cash.getByTestId('mission-cash-amount')).toContainText(/1.500,00/);
  await cash.getByRole('button', { name: 'Encaissé' }).click();
  const dialog = driver.getByRole('dialog');
  await expect(dialog.getByLabel('Montant reçu')).toHaveValue(/^1500/);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(driver.getByText('Encaissement déclaré')).toBeVisible();
  await expect(cash).toContainText('en attente de remise');
  await driverContext.close();

  // ─── Caisse livreurs : « Argent reçu », puis le reçu apparaît sur la commande ───
  await login(page);
  await page.goto('/admin/cash-desk');
  const item = page.getByTestId('cash-desk-item').filter({ hasText: order.reference });
  await expect(item).toContainText(/1.500,00/);
  await item.getByRole('button', { name: 'Argent reçu' }).click();
  await page.getByRole('button', { name: 'Oui, argent reçu' }).click();
  await expect(page.getByText('Remise enregistrée, reçu émis')).toBeVisible();
  await expect(page.getByTestId('cash-desk-item').filter({ hasText: order.reference })).toHaveCount(
    0,
  );

  await page.goto(`/admin/orders/${order.id}`);
  const payments = page.getByTestId('payments-list');
  await expect(payments).toContainText('Encaissé à la livraison par');
  await expect(payments.getByRole('button', { name: /REC-/ })).toBeVisible();
  await expect(page.getByTestId('payment-pending-remittance')).toHaveCount(0);
  await api.dispose();
});
