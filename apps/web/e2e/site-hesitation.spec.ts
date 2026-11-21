import { expect, type Locator, type Page, test } from '@playwright/test';

import { login } from './helpers';
import { gotoSignedIn, pickEventDate, signUpOnSite } from './site-helpers';

const SITE = 'http://dar-diafa.localhost:3101';

/** Jour civil à Casablanca, dans `days` jours (AAAA-MM-JJ), en évitant la date bloquée du seed. */
function freeDayIn(days: number): string {
  const day = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
      new Date(Date.now() + offset * 86_400_000),
    );
  return day(days) === '2026-12-31' ? day(days + 1) : day(days);
}

/**
 * Ordre VISUEL d'un nombre à milliers (« 163 500 ») dans un élément : chaque groupe de chiffres
 * est mesuré à l'écran. Le groupe des milliers doit être à gauche de celui des centaines, en
 * arabe comme en français (un nombre se lit toujours de gauche à droite).
 */
async function expectReadableNumber(element: Locator, thousands: string, units: string) {
  const positions = await element.evaluate(
    (root, { high, low }) => {
      const found: { thousands?: number; units?: number } = {};
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        const match = new RegExp(`${high}[\\s\\u202f\\u00a0]${low}`).exec(text);
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + high.length);
        found.thousands = range.getBoundingClientRect().x;
        range.setStart(node, match.index + high.length + 1);
        range.setEnd(node, match.index + high.length + 1 + low.length);
        found.units = range.getBoundingClientRect().x;
        break;
      }
      return found;
    },
    { high: thousands, low: units },
  );
  expect(positions.thousands, `« ${thousands} ${units} » absent`).toBeDefined();
  expect(positions.thousands).toBeLessThan(positions.units ?? 0);
}

/** Choix d'une gamme du comparateur (Mariage), en gardant les formules déjà choisies. */
async function chooseKeepingOthers(page: Page, index: number) {
  const card = page.getByTestId('compare-grid').getByTestId('compare-card').nth(index);
  await card.getByTestId('choose-range').click();
  const dialog = page.getByTestId('replace-dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByTestId('keep-both').click();
  await expect(card.getByTestId('compare-in-cart')).toBeVisible();
}

test('client qui hésite entre trois gammes : fourchette (FR, AR), « Option », back-office', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(240_000);
  const lastName = `Hesite${Date.now().toString(36).slice(-4)}`;

  // Visiteur : Mariage Essentiel (280), Premium (360) et Luxe (450 MAD) pour 150 invités
  await page.goto('/catalogue/comparer?type=WEDDING');
  await page.getByTestId('range-comparator').getByTestId('guests-field').fill('150');
  for (const index of [0, 1, 2]) await chooseKeepingOthers(page, index);

  // « Ma demande » : chaque formule en « Option », total en fourchette (et non 163 500)
  await page.goto('/demande');
  const review = page.getByTestId('cart-review');
  await expect(review.getByTestId('option-badge')).toHaveCount(3);
  await expect(review.getByTestId('cart-total')).toContainText(
    /entre\s42\s000\set\s67\s500\sMAD,\sselon\sla\sgamme\schoisie/,
  );
  await expect(review.getByTestId('cart-total')).not.toContainText(/163\s500/);
  await expect(review.getByTestId('cart-total')).toContainText(
    'Estimation : le devis final est envoyé par le traiteur.',
  );

  // En arabe : nombres dans l'ordre de lecture (« 42 000 », « 67 500 »), د.م.
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: SITE }]);
  await page.goto('/demande');
  const total = page.getByTestId('cart-review').getByTestId('cart-total');
  await expect(total).toContainText('حسب الفئة المختارة');
  await expect(total).toContainText('د.م.');
  await expectReadableNumber(total, '42', '000');
  await expectReadableNumber(total, '67', '500');
  await expectReadableNumber(
    page.getByTestId('cart-review').getByTestId('line-amount').first(),
    '42',
    '000',
  );
  await expect(page.getByTestId('cart-review').getByTestId('option-badge').first()).toHaveText(
    'خيار',
  );

  // Inscription (la sélection est gardée), puis envoi avec les trois formules
  await context.clearCookies({ name: 'NEXT_LOCALE' });
  await signUpOnSite(page, { firstName: 'Salma', lastName });
  await gotoSignedIn(page, '/demande');
  const wizard = page.getByTestId('request-wizard');
  await wizard.getByLabel('Type d’événement').click();
  await page.getByRole('option', { name: 'Mariage' }).click();
  await pickEventDate(page, freeDayIn(50));
  await wizard.getByLabel('Heure de début').fill('19:00');
  await expect(wizard.getByLabel('Nombre d’invités')).toHaveValue('150');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByLabel('Ville').fill('Rabat');
  await wizard.getByLabel('Adresse', { exact: true }).fill('12 avenue Hassan II');
  await wizard.getByRole('button', { name: 'Suivant' }).click();
  await wizard.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByText(/Demande CMD-\d{4}-\d+ envoyée au traiteur/)).toBeVisible();

  // Back-office en arabe : « le client hésite », fourchette, somme des lignes lisible
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await login(staff);
  await staffContext.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: SITE }]);
  await staff.goto('/admin/orders');
  await expect(staff.locator('html')).toHaveAttribute('dir', 'rtl');
  await staff.getByRole('link').filter({ hasText: lastName }).click();
  await expect(staff.getByTestId('detail-hesitation')).toContainText('3');
  const ttc = staff.getByTestId('detail-total-ttc');
  await expectReadableNumber(ttc, '42', '000');
  await expectReadableNumber(ttc, '67', '500');
  // La somme des trois formules n'est donnée qu'à titre d'information, lisible : « 163 500 »
  await expectReadableNumber(staff.getByTestId('detail-total-note'), '163', '500');
  await staffContext.close();
});
