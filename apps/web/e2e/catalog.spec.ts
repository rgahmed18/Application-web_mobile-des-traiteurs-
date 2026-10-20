import path from 'node:path';

import { expect, test } from '@playwright/test';

import { login, uniqueSuffix } from './helpers';

const PHOTO = path.join(__dirname, 'fixtures', 'plat.jpg');

test('création d’un plat avec photo puis d’une formule qui le contient', async ({ page }) => {
  const suffix = uniqueSuffix();
  const dishName = `Tajine e2e ${suffix}`;
  const packageName = `Formule e2e ${suffix}`;

  await login(page);

  // ─── Plat avec photo ───
  await page.getByRole('link', { name: 'Catalogue' }).first().click();
  await expect(page).toHaveURL(/\/admin\/catalog\/dishes/);
  await page.getByRole('link', { name: 'Nouveau plat' }).first().click();

  await page.getByLabel('Nom (français)').fill(dishName);
  await page.getByLabel('Nom (arabe)').fill(`طاجين ${suffix}`);
  await page.getByLabel(/^Prix (TTC|HT)$/).fill('120');
  // L'équivalent HT/TTC est calculé en direct (TVA par défaut 10 % sur le seed : 109,09 HT)
  await expect(page.getByText(/^soit .+ (HT|TTC)$/)).toBeVisible();

  await page.getByTestId('image-input').setInputFiles(PHOTO);
  const preview = page.getByRole('img', { name: `Photo de ${dishName}` });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toHaveJSProperty('complete', true);

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Plat créé')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/catalog\/dishes$/);

  await page.getByRole('searchbox', { name: 'Rechercher par nom' }).fill(suffix);
  const dishRow = page.getByTestId('dish-list').getByRole('listitem').filter({ hasText: dishName });
  await expect(dishRow).toBeVisible();
  // Miniature servie par le stockage (variante WebP 400 px)
  await expect(dishRow.getByRole('img')).toHaveAttribute('src', /-400\.webp$/);

  // ─── Menu composé de ce plat, pour les mariages, en gamme Premium ───
  await page.getByRole('link', { name: 'Menus et formules' }).click();
  await page.getByRole('link', { name: 'Nouveau menu' }).first().click();
  await page.getByLabel('Nom (français)').fill(packageName);
  await page.getByLabel('Gamme').click();
  await page.getByRole('option', { name: 'Premium' }).click();
  await page.getByTestId('event-types').getByLabel('Mariage').check();

  await page.getByRole('button', { name: 'Ajouter un plat' }).click();
  await page.getByPlaceholder('Chercher un plat…').fill(suffix);
  await page.getByRole('option', { name: new RegExp(dishName) }).click();
  await expect(page.getByTestId('composition').getByText(dishName)).toBeVisible();
  await page.getByLabel(`Quantité par personne — ${dishName}`).fill('2');
  // Valeur des plats au détail : 2 × 120,00
  await expect(page.getByTestId('composition-value')).toContainText('240,00');

  await page.getByLabel(/^Prix par personne (TTC|HT)$/).fill('200');
  await page.getByLabel('Nombre d’invités — Minimum').fill('20');
  await page.getByLabel('Nombre d’invités — Maximum').fill('150');

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Menu créé')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Rechercher par nom' }).fill(suffix);
  const packageRow = page
    .getByTestId('package-list')
    .getByRole('listitem')
    .filter({ hasText: packageName });
  await expect(packageRow).toContainText('1 plat');
  await expect(packageRow).toContainText('20 à 150 invités');
  await expect(packageRow).toContainText('Premium · Mariage');
});

test('listes du catalogue : nouveau type d’événement proposé dans les commandes, puis archivé', async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const name = `Henné e2e ${suffix}`;
  await login(page);

  await page.goto('/admin/catalog/lists');
  const types = page.getByTestId('catalog-list-event-types');
  await expect(types.getByText('Soutenance', { exact: true })).toBeVisible();
  await types.getByRole('button', { name: 'Ajouter' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom (français)').fill(name);
  await dialog.getByLabel('Nom (arabe)').fill(`حناء ${suffix}`);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Élément enregistré.')).toBeVisible();
  const row = types.getByTestId('catalog-list-item').filter({ hasText: name });
  await expect(row).toContainText('Jamais utilisé');

  // Proposé à la création d'une commande
  await page.goto('/admin/orders/new');
  await page.getByLabel('Type d’événement').click();
  await expect(page.getByRole('option', { name })).toBeVisible();
  await page.keyboard.press('Escape');

  // Archivé : plus proposé
  await page.goto('/admin/catalog/lists');
  await row.getByRole('button', { name: new RegExp(`Plus d’actions pour .*${suffix}`) }).click();
  await page.getByRole('menuitem', { name: 'Archiver' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archiver' }).click();
  await expect(row).toContainText('Archivé');
  await page.goto('/admin/orders/new');
  await page.getByLabel('Type d’événement').click();
  await expect(page.getByRole('option', { name })).toHaveCount(0);
});
