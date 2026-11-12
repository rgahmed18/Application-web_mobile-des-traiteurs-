import { expect, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';
import { signUpOnSite } from './site-helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

test('validation des nouveaux clients : en attente, refusé avec motif, puis accepté', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const site = (await (await api.get(`${API}/settings/site`, { headers })).json()) as Record<
    string,
    unknown
  >;
  await api.put(`${API}/settings/site`, {
    headers,
    data: { ...site, requireClientApproval: true },
  });

  try {
    // Le client s'inscrit : son espace s'ouvre, mais il attend l'accord du traiteur
    const lastName = `Attente${Date.now().toString(36).slice(-4)}`;
    await signUpOnSite(page, { firstName: 'Rania', lastName });
    const notice = page.getByTestId('approval-notice');
    await expect(notice).toContainText('Votre compte attend la validation de');

    // Le traiteur le trouve parmi les clients à valider, et le refuse avec un motif
    const staff = await browser.newPage();
    await login(staff);
    await staff.goto('/admin/clients');
    await staff.getByTestId('clients-pending-filter').click();
    await staff.getByRole('link', { name: new RegExp(lastName) }).click();
    const approval = staff.getByTestId('client-approval');
    await expect(approval).toContainText('Politique de confidentialité acceptée le');
    await approval.getByRole('button', { name: 'Refuser' }).click();
    await staff.getByLabel('Motif').fill('Nous ne livrons pas votre ville');
    await staff.getByRole('button', { name: 'Refuser le client' }).click();
    await expect(approval).toContainText('Motif du refus : Nous ne livrons pas votre ville');

    await page.reload();
    await expect(notice).toContainText('n’a pas validé votre compte');
    await expect(notice).toContainText('Nous ne livrons pas votre ville');

    // Le traiteur revient sur sa décision : le client peut envoyer ses demandes
    await approval.getByRole('button', { name: 'Accepter' }).click();
    await expect(approval).toContainText('Accepté');
    await page.reload();
    await expect(page.getByTestId('client-account')).toContainText('Bonjour Rania');
    await expect(notice).toHaveCount(0);
    await staff.close();
  } finally {
    await api.put(`${API}/settings/site`, { headers, data: site });
    await api.dispose();
  }
});
