import { expect, test } from '@playwright/test';

import { totp } from './helpers';

/** Super admin du seed (base e2e recréée à chaque lancement : double authentification inactive). */
const SUPER_ADMIN = { phone: '0600000001', password: 'Password123!' };
const ACCOUNT_MENU = 'Mon compte';

test('super admin : double authentification imposée, console de la plateforme, connexion par code de secours', async ({
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

  // ─── Arrivée sur la console de la plateforme, jamais dans un back-office ───
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();
  await expect(page.getByTestId('super-admin-badge')).toBeVisible();
  await expect(page.getByTestId('kpi-active')).toBeVisible();
  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/platform$/);

  // ─── Nouveau traiteur depuis la console : essai, administrateur invité par lien ───
  const suffix = Date.now().toString(36).slice(-5);
  await page.getByRole('link', { name: 'Traiteurs' }).first().click();
  await page.getByRole('link', { name: 'Nouveau traiteur' }).first().click();
  await page.getByLabel('Nom commercial').fill(`Saveurs ${suffix}`);
  await expect(page.getByLabel('Identifiant')).toHaveValue(`saveurs-${suffix}`);
  await page.getByLabel('Email').fill(`contact-${suffix}@saveurs.ma`);
  await page.getByLabel('Téléphone').first().fill('0528000000');
  await page.getByLabel('Ville').fill('Agadir');
  await page.getByLabel('Prénom').fill('Samir');
  await page.getByLabel('Nom', { exact: true }).fill('Alaoui');
  await page
    .getByLabel('Téléphone')
    .last()
    .fill(`06${String(Date.now()).slice(-8)}`);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  const linkDialog = page.getByTestId('admin-link-dialog');
  await expect(linkDialog).toContainText(`Saveurs ${suffix}`);
  await expect(page.getByTestId('admin-link-url')).toHaveValue(/\/invitation\/[\w-]{43}$/);
  await linkDialog.getByRole('button', { name: 'Terminé' }).click();
  const row = page
    .getByTestId('traiteur-list')
    .getByRole('listitem')
    .filter({ hasText: `Saveurs ${suffix}` });
  await expect(row).toContainText('Essai');
  await expect(row).toContainText('Samir Alaoui');
  await row.getByRole('button', { name: 'Renvoyer le lien' }).click();
  await expect(page.getByTestId('admin-link-dialog')).toBeVisible();
  await page.getByTestId('admin-link-dialog').getByRole('button', { name: 'Terminé' }).click();

  // ─── Mon compte : activée, imposée (pas de bouton Désactiver) ───
  await page.goto('/platform/account');
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
  await expect(page.getByTestId('super-admin-badge')).toBeVisible();
});
