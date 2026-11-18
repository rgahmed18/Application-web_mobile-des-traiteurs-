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
  await comparator.getByTestId('guests-field').fill('200');
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

test('nombre d’invités : saisie exacte et validation, estimation, limites du menu', async ({
  page,
}) => {
  await page.goto('/catalogue/comparer?type=WEDDING');
  const comparator = page.getByTestId('range-comparator');
  const field = comparator.getByTestId('guests-field');
  const essentiel = comparator.getByTestId('compare-grid').getByTestId('compare-card').nth(0);
  // Vide au départ : prix par personne seulement, sans estimation ni mention
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', 'Ex. : 150');
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await expect(essentiel).toContainText('280,00 MAD');
  await expect(essentiel.getByTestId('compare-estimate')).toHaveCount(0);
  await expect(comparator.getByTestId('estimate-note')).toHaveCount(0);

  // Saisie invalide : message clair, aucune estimation
  await field.fill('12,5');
  await expect(comparator.getByTestId('guests-error')).toHaveText(
    'Saisissez un nombre entier d’invités (sans virgule ni lettre).',
  );
  await field.fill('0');
  await expect(comparator.getByTestId('guests-error')).toHaveText(
    'Le nombre d’invités doit être compris entre 1 et 5000.',
  );
  await expect(essentiel.getByTestId('compare-estimate')).toHaveCount(0);

  // Nombre exact : 280 MAD × 150 invités
  await field.fill('150');
  await expect(comparator.getByTestId('guests-error')).toHaveCount(0);
  await expect(essentiel.getByTestId('compare-estimate')).toHaveText(
    /env\.\s42\s000\sMAD\spour\s150\sinvités/,
  );
  await expect(comparator.getByTestId('estimate-note')).toHaveText(
    'Estimation : le devis final est envoyé par le traiteur.',
  );
  // Boutons − / + : par dizaine
  await comparator.getByTestId('guests-more').click();
  await expect(field).toHaveValue('160');
  await comparator.getByTestId('guests-less').click();
  await expect(field).toHaveValue('150');

  // Hors des limites du menu (80 à 600) : avertissement, choix toujours possible
  await field.fill('50');
  await expect(essentiel.getByTestId('guests-warning')).toHaveText(
    'Ce menu est prévu pour 80 à 600 invités.',
  );
  await expect(essentiel.getByTestId('choose-range')).toBeEnabled();
});

test('un seul nombre d’invités et une formule par événement : « Ma demande », remplacement', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/catalogue/comparer?type=WEDDING');
  const comparator = page.getByTestId('range-comparator');
  const cards = comparator.getByTestId('compare-grid').getByTestId('compare-card');
  await comparator.getByTestId('guests-field').fill('150');
  await cards.nth(0).getByTestId('choose-range').click();
  await expect(cards.nth(0).getByTestId('compare-in-cart')).toBeVisible();

  // Même événement : remplacer la formule Essentiel par la Premium
  await cards.nth(1).getByTestId('choose-range').click();
  const dialog = page.getByTestId('replace-dialog');
  await expect(dialog).toContainText(
    'Vous avez déjà la Formule Mariage Essentiel. La remplacer par la Formule Mariage Premium ?',
  );
  await dialog.getByTestId('replace-menu').click();
  await expect(cards.nth(1).getByTestId('compare-in-cart')).toBeVisible();
  await expect(cards.nth(0).getByTestId('choose-range')).toBeVisible();
  await expect(page.getByTestId('site-nav-request-count')).toHaveText('1');

  // « Ma demande » : même nombre d'invités, ligne détaillée, total estimé
  await page.getByTestId('site-nav-request').click();
  const review = page.getByTestId('cart-review');
  await expect(review.getByTestId('guests-field')).toHaveValue('150');
  await expect(review.getByTestId('cart-line')).toHaveCount(1);
  await expect(review.getByTestId('line-amount')).toHaveText(
    /360,00\sMAD\s\/\spers\.\s×\s150\sinvités\s=\senv\.\s54\s000\sMAD/,
  );
  await expect(review).not.toContainText('Pour tous vos invités');
  await expect(review.getByTestId('cart-total')).toContainText(/env\.\s54\s000\sMAD/);
  await expect(review.getByTestId('cart-total')).toContainText('Estimation');
  // Nombre modifié dans « Ma demande » : repris dans le comparateur
  await review.getByTestId('guests-field').fill('200');
  await expect(review.getByTestId('line-amount')).toHaveText(/=\senv\.\s72\s000\sMAD/);
  await page.goto('/catalogue/comparer?type=WEDDING');
  await expect(comparator.getByTestId('guests-field')).toHaveValue('200');

  // « Garder les deux » : possible, avec une note dans « Ma demande »
  await cards.nth(2).getByTestId('choose-range').click();
  await page.getByTestId('replace-dialog').getByTestId('keep-both').click();
  await expect(page.getByTestId('site-nav-request-count')).toHaveText('2');
  await page.getByTestId('site-nav-request').click();
  await expect(page.getByTestId('hesitation-note')).toHaveText(
    'Vous hésitez entre plusieurs gammes ? Le traiteur vous conseillera.',
  );
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
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
  // Vide au départ (« مثال: 150 ») ; saisie exacte au clavier numérique
  const field = comparator.getByTestId('guests-field');
  await expect(field).toHaveAttribute('placeholder', 'مثال: 150');
  await expect(cards.nth(0).getByTestId('compare-estimate')).toHaveCount(0);
  await field.fill('150');
  await expect(cards.nth(0).getByTestId('compare-estimate')).toContainText('د.م.');
  await expect(cards.nth(0).getByTestId('compare-estimate')).toContainText('150 ضيف');
  // Premium Aqiqa : 240 × 150 = 36 000
  await expect(cards.nth(0).getByTestId('compare-estimate')).toContainText(/36\s000/);
  // Le carrousel avance vers la gauche en arabe
  const [first, second] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
  ]);
  expect((second?.x ?? 0) < (first?.x ?? 0)).toBe(true);
  await expect(page.getByTestId('choose-bar')).toContainText('د.م.');
  await expect(page.getByTestId('compare-position')).toContainText('1 / 3');
  await expectNoOverflow(page);

  // « Ma demande » en arabe : même nombre, ligne détaillée et total en د.م.
  await page.getByTestId('choose-bar').getByRole('button').click();
  await page.getByTestId('site-quote').click();
  const review = page.getByTestId('cart-review');
  await expect(review.getByTestId('guests-field')).toHaveValue('150');
  await expect(review.getByTestId('line-amount')).toContainText('150 ضيف');
  await expect(review.getByTestId('line-amount')).toContainText('د.م.');
  await expect(review.getByTestId('cart-total')).toContainText(/36\s000/);
  await expectNoOverflow(page);
});
