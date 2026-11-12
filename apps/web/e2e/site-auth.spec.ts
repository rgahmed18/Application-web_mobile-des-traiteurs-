import { expect, test } from '@playwright/test';

import { MANAGER } from './helpers';
import {
  newMoroccanPhone,
  receivedCode,
  requestSiteCode,
  signUpOnSite,
  typeSiteCode,
} from './site-helpers';

test('site client : inscription par code SMS avec consentement, puis reconnexion directe', async ({
  page,
}) => {
  const phone = newMoroccanPhone();
  await page.goto('/connexion');
  await requestSiteCode(page, phone.typed);
  await expect(page.getByTestId('client-login-code')).toContainText('Code envoyé par SMS');
  await typeSiteCode(page, await receivedCode(phone.e164));

  // Nouveau client : inscription, consentement obligatoire (case jamais cochée d'avance)
  const signup = page.getByTestId('client-signup');
  await signup.getByLabel('Prénom').fill('Salma');
  await signup.getByLabel('Nom', { exact: true }).fill('Bennani');
  await expect(signup.getByTestId('privacy-consent')).not.toBeChecked();
  await signup.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(signup).toContainText(
    'Cochez la case pour accepter la politique de confidentialité',
  );
  const policy = signup.getByRole('link', { name: 'politique de confidentialité' });
  await expect(policy).toHaveAttribute('href', '/confidentialite');
  await signup.getByTestId('privacy-consent').click();
  await signup.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/espace$/);
  await expect(page.getByTestId('client-account')).toContainText('Bonjour Salma');

  // Session du site client : le back-office reste fermé à ce compte
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);

  // Déconnexion, puis reconnexion directe (sans nouvelle inscription)
  await page.goto('/espace');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await requestSiteCode(page, phone.typed);
  await typeSiteCode(page, await receivedCode(phone.e164));
  await expect(page.getByTestId('client-account')).toContainText('Bonjour Salma');
});

test('site client : politique de confidentialité, personnel renvoyé vers l’espace de gestion', async ({
  page,
}) => {
  await page.goto('/confidentialite');
  const policy = page.getByTestId('privacy-policy');
  await expect(policy).toContainText('Responsable du traitement');
  await expect(policy).toContainText('loi n° 09-08');
  await expect(policy).toContainText(/Version 2026-11\.[0-9a-f]{16}/);

  // Le gérant (personnel) ne devient jamais client de son propre traiteur
  await page.goto('/connexion');
  await requestSiteCode(page, MANAGER.phone);
  await typeSiteCode(page, await receivedCode('+212600000002'));
  await expect(
    page.getByText(/membre de l’équipe : connectez-vous à l’espace de gestion/),
  ).toBeVisible();
  await expect(page.getByTestId('client-account')).toHaveCount(0);
});

test('site client : numéro étranger, code reçu par e-mail, en arabe', async ({ page, context }) => {
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'ar', url: 'http://dar-diafa.localhost:3101' },
  ]);
  const foreign = `+3361${String(Date.now()).slice(-7)}`;
  const email = `mre-${Date.now().toString(36)}@exemple.fr`;
  await page.goto('/connexion');
  const form = page.getByTestId('client-login-phone');
  await form.getByLabel('رقم الهاتف').fill(foreign);
  await form.getByRole('button', { name: 'استلام الرمز' }).click();
  await form.getByLabel('البريد الإلكتروني').fill(email);
  await form.getByRole('button', { name: 'استلام الرمز' }).click();
  await expect(page.getByTestId('client-login-code')).toContainText('هذا البريد');
  await page
    .getByTestId('client-login-code')
    .getByLabel('رمز من 6 أرقام')
    .pressSequentially(await receivedCode(email));
  const signup = page.getByTestId('client-signup');
  await signup.getByLabel('الاسم الأول').fill('كريم');
  await signup.getByLabel('اسم العائلة').fill('العلوي');
  // L'adresse a déjà reçu le code : pas de nouveau champ e-mail
  await expect(signup.getByLabel('البريد الإلكتروني (اختياري)')).toHaveCount(0);
  await signup.getByTestId('privacy-consent').click();
  await signup.getByRole('button', { name: 'إنشاء حسابي' }).click();
  await expect(page.getByTestId('client-account')).toContainText('مرحبًا كريم');
});

test('site client : inscription réutilisable par les autres parcours', async ({ page }) => {
  await signUpOnSite(page, { firstName: 'Nadia', lastName: 'Tazi' });
  await expect(page.getByTestId('site-account-link')).toBeVisible();
});
