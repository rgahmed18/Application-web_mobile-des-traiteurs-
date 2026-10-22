import { expect, test } from '@playwright/test';

import { totp } from './helpers';

/** Super admin du seed (base e2e recréée à chaque lancement : double authentification inactive). */
const SUPER_ADMIN = { phone: '0600000001', password: 'Password123!' };
const ACCOUNT_MENU = 'Mon compte';

test('super admin : double authentification imposée, codes de secours, puis connexion par code', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const signIn = async () => {
    await page.goto('/admin/login');
    await page.getByLabel('Téléphone ou email').fill(SUPER_ADMIN.phone);
    await page.getByRole('textbox', { name: 'Mot de passe' }).fill(SUPER_ADMIN.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByTestId('two-factor-step')).toBeVisible();
  };

  // ─── Première connexion : activation obligatoire avant tout accès ───
  await signIn();
  const step = page.getByTestId('two-factor-step');
  test.skip(
    await step.getByRole('heading', { name: 'Double authentification', exact: true }).isVisible(),
    'Compte déjà activé : serveurs e2e réutilisés sans base recréée',
  );
  await expect(
    step.getByRole('heading', { name: 'Activez la double authentification' }),
  ).toBeVisible();
  await expect(page.getByTestId('two-factor-qr')).toBeVisible();
  const secret = (await page.getByTestId('two-factor-secret').textContent()) ?? '';
  // Aucune session avant le code : le tableau de bord n'est pas accessible
  await page.getByLabel('Code de l’application').pressSequentially(totp(secret));
  const codes = page.getByTestId('recovery-codes');
  await expect(codes.getByRole('listitem')).toHaveCount(10);
  const firstCode = ((await codes.getByRole('listitem').first().textContent()) ?? '').trim();
  const continueButton = page.getByRole('button', { name: 'Continuer vers l’espace de gestion' });
  await expect(continueButton).toBeDisabled();
  await page.getByText('J’ai rangé ces codes en lieu sûr').click();
  await continueButton.click();
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();

  // ─── Mon compte : activée, imposée (pas de bouton Désactiver) ───
  await page.goto('/admin/settings?tab=account');
  const status = page.getByTestId('two-factor-status');
  await expect(status).toContainText('Activée');
  await expect(status).toContainText('10 codes de secours restants');
  await expect(page.getByRole('button', { name: 'Désactiver' })).toHaveCount(0);

  // ─── Connexion suivante : code de secours (téléphone perdu), à usage unique ───
  await page.getByRole('button', { name: ACCOUNT_MENU }).click();
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await signIn();
  await page.getByRole('button', { name: /utiliser un code de secours/ }).click();
  await page.getByLabel('Code de secours').fill(firstCode);
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();
});
