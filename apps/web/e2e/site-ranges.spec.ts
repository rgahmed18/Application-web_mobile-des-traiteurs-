import { expect, type Page, request as apiRequest, test } from '@playwright/test';

import { apiLogin, login } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';
const SITE = 'http://dar-diafa.localhost:3101';

/** Rien ne déborde horizontalement (écran de téléphone). */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

interface RangeItem {
  id: string;
  code: string;
  name: { fr: string; ar?: string };
  description: { fr: string; ar?: string } | null;
  isActive: boolean;
  finish: string;
  included: { fr: string[]; ar: string[] };
}

test('gammes : finition et « Ce qui est inclus » réglés dans Catalogue → Listes', async ({
  page,
}) => {
  const api = await apiRequest.newContext();
  const headers = await apiLogin(api);
  const ranges = (await (
    await api.get(`${API}/catalog/lists/ranges`, { headers })
  ).json()) as RangeItem[];
  const premium = ranges.find((range) => range.code === 'PREMIUM');
  if (!premium) throw new Error('Gamme Premium absente');
  // Valeurs par défaut : Essentiel ivoire, Premium bronze, Luxe or
  expect(ranges.map((range) => [range.code, range.finish])).toEqual([
    ['STANDARD', 'ivory'],
    ['PREMIUM', 'bronze'],
    ['LUXE', 'gold'],
  ]);
  expect(ranges[0]?.name.fr).toBe('Essentiel');

  try {
    await login(page);
    await page.goto('/admin/catalog/lists');
    const section = page.getByTestId('catalog-list-ranges');
    const row = section.getByTestId('catalog-list-item').filter({ hasText: 'Premium' });
    await row.getByRole('button', { name: /Plus d’actions pour Premium/ }).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('finish-bronze')).toHaveAttribute('aria-checked', 'true');
    // Aperçu : symbole + nom, jamais la couleur seule
    await expect(dialog.getByTestId('finish-gold').getByTestId('range-badge')).toContainText(
      'Premium',
    );
    await dialog.getByTestId('finish-gold').click();
    await dialog.getByTestId('included-add-fr').click();
    await dialog
      .getByLabel(/Ce qui est inclus \(français\), ligne \d+/)
      .last()
      .fill('Photographe');
    await dialog.getByTestId('included-add-ar').click();
    await dialog
      .getByLabel(/Ce qui est inclus \(arabe\), ligne \d+/)
      .last()
      .fill('مصور');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Élément enregistré.')).toBeVisible();

    const saved = (
      (await (await api.get(`${API}/catalog/lists/ranges`, { headers })).json()) as RangeItem[]
    ).find((range) => range.code === 'PREMIUM');
    expect(saved?.finish).toBe('gold');
    expect(saved?.included.fr.at(-1)).toBe('Photographe');
    expect(saved?.included.ar.at(-1)).toBe('مصور');
  } finally {
    await api.patch(`${API}/catalog/lists/ranges/${premium.id}`, {
      headers,
      data: {
        name: premium.name,
        description: premium.description,
        isActive: premium.isActive,
        finish: premium.finish,
        included: premium.included,
      },
    });
    await api.dispose();
  }
});

test('téléphone en arabe : menu plein écran, finitions, comparateur, fiche et montée en gamme', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: SITE }]);
  await page.goto('/catalogue');
  const catalog = page.getByTestId('site-catalog');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(catalog.getByTestId('catalog-card').first()).toBeVisible();

  // Cartes à la finition de leur gamme : badge avec symbole et nom arabe
  const prestige = catalog.getByTestId('catalog-card').filter({ hasText: 'عرض العرس الفاخر' });
  await expect(prestige).toHaveAttribute('data-finish', 'gold');
  await expect(prestige.getByTestId('range-badge')).toContainText('فاخرة');
  await expect(prestige.locator('[data-symbol="crown"]')).toHaveCount(1);
  await expect(prestige.getByTestId('range-included')).toContainText('مشرف خاص يوم الحفل');
  const essentiel = catalog.getByTestId('catalog-card').filter({ hasText: 'عرض العرس الأساسي' });
  await expect(essentiel).toHaveAttribute('data-finish', 'ivory');
  await expect(essentiel.getByTestId('range-badge')).toContainText('أساسية');
  await expectNoOverflow(page);

  // En-tête collant : « عرض سعر » toujours visible en bas de page, sans barre en bas
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByTestId('site-header')).toHaveAttribute('data-scrolled', '');
  await expect(page.getByTestId('site-quote')).toBeInViewport();
  await expect(page.getByTestId('sticky-quote')).toHaveCount(0);

  // Menu plein écran : liens, devis, connexion ; Échap le ferme
  await page.getByTestId('site-menu-button').click();
  const menu = page.getByTestId('site-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'الكتالوج' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('link', { name: 'اطلب عرض سعر' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Comparateur : trois cartes à faire glisser, Essentiel puis Premium puis Luxe
  await catalog.getByTestId('compare-link').click();
  await expect(page).toHaveURL(/\/catalogue\/comparer\?type=WEDDING/);
  const cards = page.getByTestId('compare-cards').getByRole('article');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('أساسية');
  await expect(cards.nth(0)).toContainText('280');
  await expect(cards.nth(2)).toContainText('فاخرة');
  await expect(page.getByTestId('compare-table')).toBeHidden();
  await cards.nth(2).scrollIntoViewIfNeeded();
  await expect(page.getByText('اسحبوا للمقارنة · 3 / 3')).toBeVisible();
  await expectNoOverflow(page);

  // Fiche Luxe : encart « مشمول في فئة فاخرة », lien vers le comparateur
  await cards.nth(2).getByRole('link', { name: 'عرض القائمة' }).click();
  const item = page.getByTestId('catalog-item');
  await expect(item.getByTestId('included-panel')).toContainText('مشمول في فئة فاخرة');
  await expect(item.getByTestId('compare-link')).toBeVisible();

  // « Ma demande » : Essentiel → suggestion Premium, + 80 درهم par personne, acceptée
  await page.goto('/catalogue?type=WEDDING');
  await page
    .getByTestId('catalog-card')
    .filter({ hasText: 'عرض العرس الأساسي' })
    .getByTestId('add-to-cart')
    .click();
  await page.getByTestId('site-quote').click();
  const suggestion = page.getByTestId('upgrade-suggestion');
  await expect(suggestion).toContainText('عرض العرس الممتاز');
  await expect(suggestion).toContainText('80');
  await suggestion.getByTestId('upgrade-accept').click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await expect(page.getByTestId('cart-line')).toContainText('عرض العرس الممتاز');
  // Premium → Luxe : nouvelle suggestion, refusée (« لا شكراً »)
  await expect(page.getByTestId('upgrade-suggestion')).toContainText('عرض العرس الفاخر');
  await page.getByTestId('upgrade-dismiss').click();
  await expect(page.getByTestId('upgrade-suggestion')).toHaveCount(0);
  await expectNoOverflow(page);
});

test('ancien navigateur, animations réduites : contenu affiché, en-tête opaque, comparateur', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  // Navigateur sans IntersectionObserver ni flou d'arrière-plan
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const condition: (text: string) => boolean = CSS.supports;
    const declaration: (property: string, value: string) => boolean = CSS.supports;
    Object.defineProperty(CSS, 'supports', {
      value: (property: string, value?: string): boolean => {
        if (property.includes('backdrop-filter')) return false;
        return value === undefined
          ? condition.call(CSS, property)
          : declaration.call(CSS, property, value);
      },
    });
  });
  await page.goto(`${SITE}/`);
  // Apparitions au défilement : tout est affiché d'emblée
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll('.site-reveal')].filter(
        (element) => getComputedStyle(element).opacity !== '1',
      ).length,
  );
  expect(hidden).toBe(0);

  await page.goto(`${SITE}/catalogue`);
  await page.evaluate(() => window.scrollTo(0, 600));
  const header = page.getByTestId('site-header');
  await expect(header).toHaveAttribute('data-scrolled', '');
  // La feuille de styles prévoit le préfixe Safari 15 et un repli opaque
  const css = await page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    return (await Promise.all(links.map(async (link) => (await fetch(link.href)).text()))).join('');
  });
  expect(css).toContain('-webkit-backdrop-filter');
  // Pas d'effet de survol animé (reflet, soulèvement) avec « réduire les animations »
  const card = page.getByTestId('catalog-card').filter({ hasText: 'Formule Mariage Premium' });
  await card.hover();
  expect(await card.evaluate((element) => getComputedStyle(element).transform)).toBe('none');

  await page.goto(`${SITE}/catalogue/comparer?type=WEDDING`);
  const table = page.getByTestId('compare-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveCount(3);
  await expect(table).toContainText('Essentiel');
  await expect(table).toContainText('Tout le Premium, et :');
  await context.close();
});
