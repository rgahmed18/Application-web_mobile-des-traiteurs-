import { expect, type Page, test } from '@playwright/test';

import { gotoSignedIn, signUpOnSite } from './site-helpers';

/** Rien ne déborde horizontalement (écran de téléphone). */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('site client sur téléphone, en arabe : pages publiques et espace client sans débordement', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 360, height: 760 });
  await signUpOnSite(page, { firstName: 'Sanae', lastName: 'Fassi' });
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'ar', url: 'http://dar-diafa.localhost:3101' },
  ]);

  for (const [path, testId] of [
    ['/', 'site-home'],
    ['/catalogue', 'site-catalog'],
    ['/demande', 'request-wizard'],
    ['/espace', 'client-account'],
    ['/espace/demandes', 'client-account'],
    ['/espace/devis', 'client-account'],
    ['/espace/factures', 'client-account'],
    ['/espace/paiements', 'client-account'],
    ['/espace/profil', 'client-profile'],
  ] as const) {
    await gotoSignedIn(page, path);
    await expect(page.getByTestId(testId)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoOverflow(page);
  }
  await page.goto('/confidentialite');
  await expect(page.getByTestId('privacy-policy')).toContainText('سياسة الخصوصية');
  await expectNoOverflow(page);
});
