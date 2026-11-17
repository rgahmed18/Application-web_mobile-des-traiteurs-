import { expect, type Page, request as apiRequest, test } from '@playwright/test';

import { apiLogin, uniqueSuffix } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';
const SITE = 'http://dar-diafa.localhost:3101';

/** Libellés des pastilles « Événement » du catalogue, dans l'ordre affiché, une fois chargées. */
async function eventChips(page: Page, last: string): Promise<string[]> {
  const chips = page.getByTestId('site-catalog').getByRole('group').first().getByRole('button');
  await expect(chips.last()).toHaveText(last);
  return chips.allInnerTexts();
}

/** Rien ne déborde horizontalement (écran de téléphone). */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('filtres « Événement » : « Autre » en dernier, mêmes types en français et en arabe', async ({
  page,
  context,
}) => {
  await page.goto('/catalogue');
  // « Autre » toujours en dernier
  const fr = await eventChips(page, 'Autre');
  expect(fr).not.toContain('Baptême');

  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: SITE }]);
  await page.reload();
  const ar = await eventChips(page, 'أخرى');
  // Un type publié apparaît dans les deux langues
  expect(ar).toHaveLength(fr.length);
});

test('comparateur : Mariage, Fiançailles et Aqiqa, Essentiel → Premium → Luxe, estimation, choix', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/catalogue?type=ENGAGEMENT');
  await page.getByTestId('compare-link').click();
  await expect(page).toHaveURL(/\/catalogue\/comparer\?type=ENGAGEMENT/);
  const comparator = page.getByTestId('range-comparator');
  const tabs = comparator.getByTestId('compare-event-tabs');
  for (const name of ['Mariage', 'Fiançailles', 'Aqiqa', 'Anniversaire', 'Soutenance', 'Autre']) {
    await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
  }
  const grid = comparator.getByTestId('compare-grid');
  for (const [tab, menus] of [
    ['Mariage', ['Formule Mariage Essentiel', 'Formule Mariage Premium', 'Formule Mariage Luxe']],
    [
      'Fiançailles',
      ['Formule Fiançailles Essentiel', 'Formule Fiançailles Premium', 'Formule Fiançailles Luxe'],
    ],
    ['Aqiqa', ['Formule Aqiqa Essentiel', 'Formule Aqiqa Premium', 'Formule Aqiqa Luxe']],
  ] as const) {
    await tabs.getByRole('tab', { name: tab, exact: true }).click();
    await expect(tabs.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const cards = grid.getByTestId('compare-card');
    await expect(cards).toHaveCount(3);
    // Toujours Essentiel → Premium → Luxe ; « Le plus choisi » sur Premium
    expect(await cards.evaluateAll((all) => all.map((card) => card.dataset.range))).toEqual([
      'STANDARD',
      'PREMIUM',
      'LUXE',
    ]);
    await expect(cards.nth(1).getByTestId('most-chosen')).toHaveText('Le plus choisi');
    for (const [index, menu] of menus.entries()) {
      await expect(cards.nth(index).getByTestId('compare-menu')).toHaveText(menu);
    }
  }

  // Estimation selon le nombre d'invités : Fiançailles Essentiel, 200 MAD × 200 invités
  await tabs.getByRole('tab', { name: 'Fiançailles', exact: true }).click();
  await comparator.getByTestId('compare-guests').fill('200');
  await expect(comparator.getByTestId('guests-value')).toHaveText('200 invités');
  const essentiel = grid.getByTestId('compare-card').nth(0);
  await expect(essentiel.getByTestId('compare-estimate')).toHaveText(
    /env\.\s40\s000\sMAD\spour\s200\sinvités/,
  );
  await expect(comparator.getByTestId('estimate-note')).toContainText(
    'le devis final est envoyé par le traiteur',
  );

  // « Choisir cette gamme » : le menu Premium rejoint « Ma demande »
  const premium = grid.getByTestId('compare-card').nth(1);
  await premium.getByTestId('choose-range').click();
  await expect(premium.getByTestId('compare-in-cart')).toBeVisible();
  await expect(page.getByTestId('site-nav-request-count')).toHaveText('1');
  await page.goto('/demande');
  await expect(page.getByTestId('cart-line')).toContainText('Formule Fiançailles Premium');
  const guests = await page.evaluate(() => window.localStorage.getItem('gt-invites:dar-diafa'));
  expect(guests).toBe('200');

  // Accueil : « Choisissez votre gamme », onglets par événement
  await page.goto('/');
  const home = page.getByTestId('home-ranges');
  await expect(home.getByRole('heading', { name: 'Choisissez votre gamme' })).toBeVisible();
  await home.getByRole('tab', { name: 'Aqiqa', exact: true }).click();
  await expect(home.getByTestId('compare-grid').getByTestId('compare-menu').first()).toHaveText(
    'Formule Aqiqa Essentiel',
  );
});

test('gamme sans menu pour l’événement : carte « Sur demande », ajoutée à « Ma demande » ; type sans menu masqué', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const suffix = uniqueSuffix();
  const created: { menu?: string; type?: string; empty?: string } = {};
  try {
    const listItem = async (name: { fr: string; ar: string }) =>
      (await (
        await api.post(`${API}/catalog/lists/event-types`, {
          headers,
          data: { name, description: null, isActive: true },
        })
      ).json()) as { id: string; code: string };
    const henna = await listItem({ fr: `Henné ${suffix}`, ar: `حناء ${suffix}` });
    created.type = henna.id;
    // Type publié sans aucun menu : jamais d'onglet vide
    const empty = await listItem({ fr: `Sbou ${suffix}`, ar: `سبوع ${suffix}` });
    created.empty = empty.id;
    const ranges = (await (await api.get(`${API}/catalog/lists/ranges`, { headers })).json()) as {
      id: string;
      code: string;
    }[];
    const dishes = (await (
      await api.get(`${API}/catalog/dishes?pageSize=1`, { headers })
    ).json()) as { items: { id: string }[] };
    const menu = (await (
      await api.post(`${API}/catalog/packages`, {
        headers,
        data: {
          name: { fr: `Formule Henné ${suffix} Essentiel`, ar: `عرض الحناء ${suffix} الأساسي` },
          description: null,
          pricePerPerson: 15_000,
          taxRateBps: null,
          minGuests: 10,
          maxGuests: 300,
          imageKey: null,
          isActive: true,
          isPublished: true,
          dishes: [{ dishId: dishes.items[0]?.id, quantity: 1 }],
          rangeId: ranges.find((range) => range.code === 'STANDARD')?.id,
          eventTypeIds: [henna.id],
        },
      })
    ).json()) as { id: string };
    created.menu = menu.id;

    // Catalogue public gardé une minute en cache : on attend le nouvel onglet
    await page.setViewportSize({ width: 390, height: 844 });
    const tab = page
      .getByTestId('compare-event-tabs')
      .getByRole('tab', { name: `Henné ${suffix}`, exact: true });
    await expect(async () => {
      await page.goto(`/catalogue/comparer?type=${henna.code}`);
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    }).toPass({ timeout: 120_000, intervals: [5_000] });
    await expect(
      page.getByTestId('compare-event-tabs').getByRole('tab', { name: `Sbou ${suffix}` }),
    ).toHaveCount(0);

    // Téléphone : Premium (mis en avant) en premier, « Sur demande », barre fixe
    const cards = page.getByTestId('compare-cards').getByTestId('compare-card');
    await expect(cards).toHaveCount(3);
    const premium = cards.nth(0);
    await expect(premium).toHaveAttribute('data-range', 'PREMIUM');
    await expect(premium.getByTestId('on-request-price')).toHaveText('Sur demande');
    await expect(page.getByTestId('choose-bar')).toContainText('Demander Premium — sur demande');
    await expectNoOverflow(page);
    await premium.getByTestId('request-range').click();
    await expect(page.getByTestId('choose-bar')).toContainText('Premium : dans ma demande');
    await page.getByTestId('site-quote').click();
    await expect(page.getByTestId('cart-range-line')).toContainText('Gamme Premium — sur demande');
  } finally {
    if (created.menu) {
      await api.post(`${API}/catalog/packages/${created.menu}/archive`, { headers });
    }
    for (const id of [created.type, created.empty]) {
      if (id) await api.post(`${API}/catalog/lists/event-types/${id}/archive`, { headers });
    }
    await api.dispose();
  }
});

test('comparateur sur téléphone, en arabe : carrousel, ordre droite-à-gauche, montants en د.م.', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: SITE }]);
  await page.goto('/catalogue/comparer?type=AQIQA');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const comparator = page.getByTestId('range-comparator');
  await expect(comparator.getByRole('heading', { level: 1 })).toContainText('عقيقة');
  const cards = comparator.getByTestId('compare-cards').getByTestId('compare-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByTestId('most-chosen')).toHaveText('الأكثر اختياراً');
  await expect(cards.nth(0).getByTestId('compare-estimate')).toContainText('د.م.');
  await expect(cards.nth(0).getByTestId('compare-estimate')).toContainText('100 ضيف');
  // Le carrousel avance vers la gauche en arabe
  const [first, second] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
  ]);
  expect((second?.x ?? 0) < (first?.x ?? 0)).toBe(true);
  await expect(page.getByTestId('choose-bar')).toContainText('د.م.');
  await expect(page.getByTestId('compare-position')).toContainText('1 / 3');
  await expectNoOverflow(page);
});
