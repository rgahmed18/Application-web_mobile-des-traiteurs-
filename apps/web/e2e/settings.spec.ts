import { expect, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/** Prochain dimanche (ou aujourd'hui), jour civil à Casablanca. */
function nextSunday(): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = new Date(Date.now() + offset * 86_400_000);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Casablanca',
      weekday: 'short',
    }).format(date);
    if (weekday === 'Sun') {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
    }
  }
  throw new Error('Aucun dimanche');
}

test('paramètres : fermeture hebdomadaire, avertissement du mode de prix et mon compte', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const initial = (await (await api.get(`${API}/settings/availability`, { headers })).json()) as {
    closedWeekdays: number[];
  };
  const account = (await (await api.get(`${API}/me/account`, { headers })).json()) as {
    firstName: string;
    lastName: string;
    locale: string;
  };

  try {
    await login(page);
    await page.goto('/admin/settings');
    await expect(page.getByRole('tab', { name: 'Entreprise' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('company-settings')).toBeVisible();
    await expect(page.getByTestId('billing-settings-legal')).toBeVisible();

    // ─── Disponibilités : fermé le dimanche ───
    await page.getByRole('tab', { name: 'Disponibilités' }).click();
    const availability = page.getByTestId('availability-settings');
    const sunday = availability.getByRole('button', { name: 'Dimanche' });
    if ((await sunday.getAttribute('aria-pressed')) !== 'true') await sunday.click();
    await expect(availability).toContainText('Fermé le : ');
    await availability.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Disponibilités enregistrées')).toBeVisible();
    const day = nextSunday();
    const check = (await (
      await api.get(`${API}/orders/availability?date=${day}`, { headers })
    ).json()) as { closed: boolean };
    expect(check.closed).toBe(true);

    // ─── Mode de prix : avertissement et confirmation, sans appliquer ───
    await page.getByRole('tab', { name: 'Mode de prix' }).click();
    const pricing = page.getByTestId('pricing-settings');
    await expect(pricing).toContainText('reçus existants ne changent pas');
    await pricing.getByRole('radio', { name: /Prix HT/ }).click();
    await pricing.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Passer en saisie HT');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
    await pricing.getByRole('button', { name: 'Annuler' }).click();

    // ─── Mon compte, depuis le menu de l'utilisateur ───
    await page.getByRole('button', { name: 'Mon compte' }).click();
    await page.getByRole('menuitem', { name: 'Mon compte' }).click();
    await expect(page).toHaveURL(/tab=account/);
    const profile = page.getByTestId('account-profile');
    await profile.getByLabel('Prénom').fill('Karima');
    await profile.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Profil enregistré')).toBeVisible();
    await page.getByRole('button', { name: 'Mon compte' }).click();
    await expect(page.getByRole('menu')).toContainText('Karima');
  } finally {
    await api.put(`${API}/settings/availability`, {
      headers,
      data: {
        ...((await (await api.get(`${API}/settings/availability`, { headers })).json()) as object),
        closedWeekdays: initial.closedWeekdays,
      },
    });
    await api.put(`${API}/me/account`, { headers, data: account });
    await api.dispose();
  }
});
