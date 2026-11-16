import path from 'node:path';

import { expect, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';
const PHOTO = path.join(__dirname, 'fixtures', 'plat.jpg');

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

test('site client : validation des nouveaux clients, photo de l’accueil, rappel juridique', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const initial = (await (await api.get(`${API}/settings/site`, { headers })).json()) as object;

  try {
    await login(page);
    await page.goto('/admin/settings?tab=site');
    const site = page.getByTestId('site-settings');
    await expect(site.getByTestId('privacy-legal-review')).toContainText(
      'À faire relire par un juriste',
    );
    await expect(site).toContainText('Désactivée : un client peut envoyer une demande');
    await site.getByRole('switch', { name: /Validation des nouveaux clients/ }).click();
    await expect(site).toContainText('Activée : un nouveau client voit son espace');

    await site.getByLabel('Présentation (français)').fill('Traiteur de mariages à Rabat');
    await site.getByTestId('site-photo-input').setInputFiles(PHOTO);
    const photo = site.getByRole('img', { name: 'Photo d’accueil n° 1' });
    await expect(photo).toBeVisible({ timeout: 30_000 });
    await expect(site).toContainText('Photo principale');
    // Apparence : palette « Prune et corail », bouton WhatsApp
    await site.getByTestId('palette-plum').click();
    await expect(site.getByTestId('palette-plum')).toHaveAttribute('aria-checked', 'true');
    await site.getByLabel('Numéro WhatsApp').fill('06 61 23 45 67');
    // Menus phares : 1 ou 2 refusés à l'enregistrement, 3 acceptés (choisis parmi les publiés :
    // un élément « Hors site » ne s'afficherait pas)
    const addPublished = () =>
      site
        .getByTestId('featured-candidate')
        .filter({ hasNotText: 'Hors site' })
        .first()
        .getByTestId('featured-add')
        .click();
    await addPublished();
    await site.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(site.getByText('Choisissez de 3 à 6 menus et buffets, ou aucun.')).toBeVisible();
    await addPublished();
    await addPublished();
    await expect(site.getByTestId('featured-selected')).toHaveCount(3);

    await site.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Réglages du site client enregistrés')).toBeVisible();
    const saved = (await (await api.get(`${API}/settings/site`, { headers })).json()) as {
      requireClientApproval: boolean;
      intro: { fr: string } | null;
      photoKeys: string[];
      palette: string;
      whatsappPhone: string | null;
      featured: unknown[];
    };
    expect(saved.requireClientApproval).toBe(true);
    expect(saved.intro?.fr).toBe('Traiteur de mariages à Rabat');
    expect(saved.photoKeys).toHaveLength(1);
    expect(saved).toMatchObject({ palette: 'plum', whatsappPhone: '+212661234567' });
    expect(saved.featured).toHaveLength(3);

    // Le site prend la palette et montre le bouton WhatsApp
    await page.goto('/');
    await expect(page.getByTestId('whatsapp-button')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/212661234567\?text=/,
    );
    await expect(page.getByTestId('site-featured').getByRole('article')).toHaveCount(3);
    const primary = await page
      .locator('.site')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--primary').trim());
    expect(primary).toBe('#6d1f52');
  } finally {
    await api.put(`${API}/settings/site`, { headers, data: initial });
    await api.dispose();
  }
});
