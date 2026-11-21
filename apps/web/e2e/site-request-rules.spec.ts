import { expect, type Page, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';
import { gotoSignedIn, pickEventDate, signUpOnSite } from './site-helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

/** Date bloquée par le seed de Dar Diafa (« Congés annuels »). */
const SEEDED_BLOCKED_DATE = '2026-12-31';

/** Jour civil du traiteur (Casablanca), dans `days` jours (AAAA-MM-JJ). */
function inDays(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** Jour libre dans au moins `days` jours (la date bloquée du seed est sautée). */
function freeDayIn(days: number): string {
  const day = inDays(days);
  return day === SEEDED_BLOCKED_DATE ? inDays(days + 1) : day;
}

/** « 12/06/2027 » : la date telle qu'affichée partout (site, back-office, PDF). */
const shown = (day: string) => day.split('-').reverse().join('/');

/** Visiteur inscrit qui choisit la formule Mariage Essentiel (80 à 600 invités) au comparateur. */
async function clientWithEssentiel(page: Page, lastName: string): Promise<void> {
  await signUpOnSite(page, { firstName: 'Nadia', lastName });
  await gotoSignedIn(page, '/catalogue/comparer?type=WEDDING');
  const card = page.getByTestId('compare-grid').getByTestId('compare-card').first();
  await expect(card).toContainText('Essentiel');
  await card.getByTestId('choose-range').click();
  await expect(card.getByTestId('compare-in-cart')).toBeVisible();
  await gotoSignedIn(page, '/demande');
}

/** Étapes 2 et 3 (choix, lieu) jusqu'au récapitulatif. */
async function toSummary(page: Page): Promise<void> {
  const wizard = page.getByTestId('request-wizard');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await expect(wizard.getByTestId('request-step-choices')).toBeVisible();
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByLabel('Ville').fill('Rabat');
  await wizard.getByLabel('Adresse', { exact: true }).fill('12 avenue Hassan II');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await expect(wizard.getByTestId('request-step-summary')).toBeVisible();
}

/** Fiche de la commande au back-office : le jour de l'événement est celui saisi par le client. */
async function expectBackOfficeDate(page: Page, lastName: string, day: string): Promise<void> {
  const staff = await page.context().browser()?.newPage();
  if (!staff) throw new Error('navigateur indisponible');
  await login(staff);
  await staff.goto('/admin/orders');
  await staff.getByRole('link').filter({ hasText: lastName }).click();
  await expect(staff.getByRole('main')).toContainText(shown(day));
  await staff.close();
}

test('demande : règles du traiteur (invités, délai), type d’événement, limites d’un menu', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Bouton WhatsApp réglé : le lien « date plus proche » y renvoie
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const initial = (await (await api.get(`${API}/settings/site`, { headers })).json()) as object;
  const configured = await api.put(`${API}/settings/site`, {
    headers,
    data: { ...initial, whatsappPhone: '+212661234567' },
  });
  expect(configured.ok(), await configured.text()).toBe(true);
  try {
    const lastName = `Regles${Date.now().toString(36).slice(-4)}`;
    await clientWithEssentiel(page, lastName);
    const wizard = page.getByTestId('request-wizard');

    // Type d'événement prérempli (toutes les formules : mariage) ; invités vides au départ
    await expect(wizard.getByLabel('Type d’événement')).toContainText('Mariage');
    const guests = wizard.getByLabel('Nombre d’invités');
    await expect(guests).toHaveValue('');
    await expect(guests).toHaveAttribute('placeholder', 'Ex. : 150');

    // Délai minimum (3 jours) : demain grisé ; lien WhatsApp pour une date plus proche
    const picker = page.getByTestId('event-date-picker');
    const tomorrow = picker.locator(`[data-day="${inDays(1)}"]`);
    if (await tomorrow.isVisible()) {
      await expect(tomorrow).toBeDisabled();
      await expect(tomorrow).toHaveAttribute('data-status', 'tooSoon');
    }
    await expect(page.getByTestId('date-too-soon-note')).toContainText('Première date possible');
    await expect(page.getByTestId('date-contact-link')).toHaveText(
      'Pour une date plus proche, contactez-nous sur WhatsApp',
    );
    await expect(page.getByTestId('date-contact-link')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/212661234567\?text=/,
    );

    // Date bloquée par le traiteur : grisée (« fermé »)
    if (inDays(3) <= SEEDED_BLOCKED_DATE) {
      const blocked = picker.locator(`[data-day="${SEEDED_BLOCKED_DATE}"]`);
      for (let step = 0; step < 3 && !(await blocked.isVisible()); step += 1) {
        const month = await picker.getByTestId('date-month').textContent();
        await picker.getByTestId('date-next-month').click();
        await expect(picker.getByTestId('date-month')).not.toHaveText(month ?? '');
      }
      await expect(blocked).toBeDisabled();
      await expect(blocked).toHaveAttribute('data-status', 'closed');
    }

    // Sous le minimum du traiteur (10) : message clair, l'étape ne change pas
    const day = freeDayIn(40);
    await pickEventDate(page, day);
    await wizard.getByLabel('Heure de début').fill('19:00');
    await guests.fill('5');
    await wizard.getByRole('button', { name: 'Suivant' }).click();
    await expect(
      wizard.getByText('Nous acceptons les demandes à partir de 10 invités.'),
    ).toBeVisible();
    await expect(wizard.getByTestId('request-step-event')).toBeVisible();

    // 50 invités : sous la limite du menu (80) → simple avertissement, la demande part quand même
    await guests.fill('50');
    await expect(wizard.getByTestId('menu-limits-warning')).toContainText(
      '« Formule Mariage Essentiel » est prévu pour 80 à 600 invités',
    );

    // Aqiqa avec une formule de mariage : avertissement, sans blocage
    await wizard.getByLabel('Type d’événement').click();
    await page.getByRole('option', { name: 'Aqiqa' }).click();
    const mismatch = wizard.getByTestId('event-type-mismatch');
    await expect(mismatch).toContainText(
      'Votre demande contient une formule prévue pour un mariage',
    );
    await expect(mismatch).toContainText('Continuer ou changer de formule ?');
    await expect(mismatch.getByTestId('mismatch-change')).toHaveAttribute(
      'href',
      '/catalogue/comparer?type=AQIQA',
    );
    await mismatch.getByTestId('mismatch-continue').click();
    await expect(mismatch).toHaveCount(0);

    await toSummary(page);
    await expect(wizard.getByTestId('summary-date')).toContainText(shown(day));
    await wizard.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(page.getByText(/Demande CMD-\d{4}-\d+ envoyée au traiteur/)).toBeVisible();
    await expect(page.getByText(`${shown(day)} · 19:00`)).toBeVisible();
  } finally {
    await api.put(`${API}/settings/site`, { headers, data: initial });
    await api.dispose();
  }
});

// Date civile de bout en bout, quel que soit le fuseau du navigateur, autour de minuit
for (const [timezoneId, start, end] of [
  ['Africa/Casablanca', '23:30', '01:30'],
  ['Europe/Paris', '00:30', '04:00'],
  ['America/New_York', '23:45', '02:00'],
] as const) {
  test.describe(`navigateur à ${timezoneId}`, () => {
    test.use({ timezoneId });

    test(`date saisie ${start} = date enregistrée (site, espace client, back-office)`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const lastName = `Fuseau${Date.now().toString(36).slice(-4)}`;
      await clientWithEssentiel(page, lastName);
      const wizard = page.getByTestId('request-wizard');
      const day = freeDayIn(60);
      await pickEventDate(page, day);
      await wizard.getByLabel('Heure de début').fill(start);
      await wizard.getByLabel('Heure de fin (facultative)').fill(end);
      await wizard.getByText('Se termine le lendemain (après minuit)').click();
      await wizard.getByLabel('Nombre d’invités').fill('150');
      await toSummary(page);
      await expect(wizard.getByTestId('summary-date')).toContainText(shown(day));
      await expect(wizard.getByTestId('summary-date')).toContainText(`${start} – ${end}`);
      await wizard.getByRole('button', { name: 'Envoyer ma demande' }).click();
      await expect(page).toHaveURL(/\/espace\/demandes\/[0-9a-f-]{36}$/);
      // Espace client : le même jour, la même heure
      await expect(page.getByText(`${shown(day)} · ${start}`)).toBeVisible();
      // Back-office : le même jour
      await expectBackOfficeDate(page, lastName, day);
    });
  });
}
