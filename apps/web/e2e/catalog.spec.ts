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

  // ─── Formule composée de ce plat ───
  await page.getByRole('link', { name: 'Formules' }).click();
  await page.getByRole('link', { name: 'Nouvelle formule' }).first().click();
  await page.getByLabel('Nom (français)').fill(packageName);

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
  await expect(page.getByText('Formule créée')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Rechercher par nom' }).fill(suffix);
  const packageRow = page
    .getByTestId('package-list')
    .getByRole('listitem')
    .filter({ hasText: packageName });
  await expect(packageRow).toContainText('1 plat');
  await expect(packageRow).toContainText('20 à 150 invités');
});
