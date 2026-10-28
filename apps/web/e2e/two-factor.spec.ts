import { expect, test } from '@playwright/test';

import { PLATFORM_URL, totp } from './helpers';

/** Super admin du seed (base e2e recréée à chaque lancement : double authentification inactive). */
const SUPER_ADMIN = { phone: '0600000001', password: 'Password123!' };
const ACCOUNT_MENU = 'Mon compte';

// La console n'est servie que sur son adresse, jamais sur celle d'un traiteur
test.use({ baseURL: PLATFORM_URL });

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

  // ─── Fiche du traiteur : suspension motivée, accès coupé, réactivation ───
  await row.getByRole('link', { name: `Saveurs ${suffix}` }).click();
  const detail = page.getByTestId('traiteur-detail');
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText(`Saveurs ${suffix}`);
  await detail.getByRole('button', { name: 'Suspendre' }).click();
  const suspendDialog = page.getByRole('dialog', { name: /Suspendre Saveurs/ });
  await suspendDialog.getByLabel('Motif (conservé dans l’historique)').fill('Abonnement impayé');
  await suspendDialog.getByRole('button', { name: 'Suspendre' }).click();
  await expect(detail.getByRole('alert')).toContainText('Abonnement impayé');
  await expect(page.getByTestId('traiteur-history')).toContainText('Traiteur suspendu');
  await detail.getByRole('button', { name: 'Réactiver' }).click();
  await expect(detail.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('traiteur-history')).toContainText('Traiteur réactivé');

  // ─── Entrer chez le traiteur : motif, bandeau, identité du super admin, prolonger, quitter ───
  const detailUrl = page.url();
  await detail.getByRole('button', { name: 'Entrer chez ce traiteur' }).click();
  const enterDialog = page.getByRole('dialog', { name: /Entrer chez Saveurs/ });
  await enterDialog
    .getByLabel('Motif (visible dans l’historique du traiteur)')
    .fill('Aide à la saisie du catalogue');
  await enterDialog.getByRole('button', { name: 'Entrer chez ce traiteur' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const banner = page.getByTestId('platform-access-banner');
  await expect(banner).toContainText(`Vous êtes chez Saveurs ${suffix} en tant que Super Admin`);
  await expect(page.getByTestId('platform-access-remaining')).toHaveText(
    /expire dans (2 h 00|1 h 5\d)/,
  );
  await expect(page.getByTestId('super-admin-identity')).toHaveText('Super Admin · plateforme');
  await expect(page.getByTestId('super-admin-badge')).toHaveCount(0);
  await banner.getByRole('button', { name: 'Prolonger' }).click();
  const extendDialog = page.getByRole('dialog', { name: /Prolonger l’accès/ });
  await extendDialog.getByLabel('Motif').fill('Import pas encore terminé');
  await extendDialog.getByRole('button', { name: 'Prolonger' }).click();
  await expect(page.getByText('Accès prolongé de 2 heures')).toBeVisible();
  await banner.getByRole('button', { name: 'Quitter et revenir à la console' }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByTestId('platform-access-banner')).toHaveCount(0);
  await expect(page.getByTestId('super-admin-badge')).toBeVisible();
  await page.goto(detailUrl);
  const history = page.getByTestId('traiteur-history');
  await expect(history).toContainText('Entrée de la plateforme');
  await expect(history).toContainText('Aide à la saisie du catalogue');
  await expect(history).toContainText('Accès de la plateforme prolongé');
  await expect(history).toContainText('Sortie de la plateforme');

  // ─── Journal d'audit : filtré sur ce traiteur ───
  await page.getByRole('link', { name: 'Journal d’audit' }).first().click();
  await page.getByLabel('Traiteur', { exact: true }).click();
  await page.getByRole('option', { name: `Saveurs ${suffix}` }).click();
  const auditList = page.getByTestId('audit-list');
  await expect(auditList).toContainText('Entrée de la plateforme');
  await expect(auditList).toContainText('Aide à la saisie du catalogue');
  await expect(auditList).toContainText('Traiteur suspendu');
  await page.getByLabel('Quoi').click();
  await page.getByRole('option', { name: 'Traiteur suspendu' }).click();
  await expect(auditList.getByRole('listitem')).toHaveCount(1);
  await expect(auditList).toContainText('Abonnement impayé');

  // ─── Permissions par défaut : une case accordée puis remise à la valeur prévue ───
  await page.getByRole('link', { name: 'Permissions par défaut' }).first().click();
  const editedCount = page.getByTestId('permissions-edited-count');
  await expect(editedCount).toContainText('Aucune case modifiée');
  const teamCatalog = page.getByRole('checkbox', { name: 'Consulter le catalogue — Équipe' });
  await expect(teamCatalog).not.toBeChecked();
  await teamCatalog.click();
  await expect(page.getByText('« Consulter le catalogue » accordée au rôle Équipe')).toBeVisible();
  await expect(teamCatalog).toBeChecked();
  await expect(editedCount).toContainText('1 case modifiée');
  await expect(page.getByTestId('permission-edited')).toHaveCount(1);
  await teamCatalog.click();
  await expect(teamCatalog).not.toBeChecked();
  await expect(editedCount).toContainText('Aucune case modifiée');

  // ─── Offres : nouveau prix en vigueur, historique conservé ───
  await page.getByRole('link', { name: 'Offres et fonctionnalités' }).first().click();
  await page.getByLabel('Nouveau prix mensuel de l’offre BASIQUE').fill('450');
  await page.getByTestId('plan-BASIQUE').getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByTestId('plan-price-BASIQUE')).toContainText('450,00');

  // ─── Journal : chaque ligne se lit sans ouvrir la base, détail avant / après au clic ───
  await page.getByRole('link', { name: 'Journal d’audit' }).first().click();
  const journal = page.getByTestId('audit-list');
  await expect(journal).toContainText('Basique : 400 → 450 MAD');
  await expect(journal).toContainText('Équipe · Consulter le catalogue : désactivée → activée');
  await expect(journal).toContainText(
    `Saveurs ${suffix} : Essai → Suspendu — motif : Abonnement impayé`,
  );
  await expect(journal).not.toContainText('::ffff:');
  await journal.getByRole('button', { name: /Basique : 400 → 450 MAD/ }).click();
  const detailDialog = page.getByTestId('audit-detail');
  await expect(detailDialog).toContainText('Prix d’une offre modifié');
  const changes = detailDialog.getByTestId('audit-detail-changes');
  await expect(changes.getByRole('row', { name: /Prix mensuel/ })).toContainText(
    /400,00 MAD.*450,00 MAD/,
  );
  await page.keyboard.press('Escape');
  await expect(detailDialog).toHaveCount(0);

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
