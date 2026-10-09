import { expect, test } from '@playwright/test';

import { login, uniqueSuffix } from './helpers';

/** Jour civil à Casablanca, dans `offset` jours. */
function casablancaDay(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

test('client, commande de 3 lignes confirmée, puis retrouvée dans le calendrier', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const suffix = uniqueSuffix();
  const lastName = `Testeur ${suffix}`;
  const phone = `06${String(Date.now()).slice(-8)}`;
  // Date à venir, répartie pour que les relances successives ne remplissent pas un même jour
  const eventDate = casablancaDay(35 + (Date.now() % 20));

  await login(page);

  // ─── Client créé par le traiteur (commande prise par téléphone) ───
  await page.getByRole('link', { name: 'Clients' }).first().click();
  await page.getByRole('button', { name: 'Nouveau client' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Téléphone').fill(phone);
  await dialog.getByLabel('Prénom').fill('Yasmine');
  await dialog.getByLabel('Nom', { exact: true }).fill(lastName);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Client enregistré')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `Yasmine ${lastName}` })).toBeVisible();

  // ─── Commande depuis la fiche client ───
  await page.getByRole('link', { name: 'Nouvelle commande' }).click();
  await expect(page.getByTestId('selected-client')).toContainText(lastName);
  await page.getByLabel('Type d’événement').click();
  await page.getByRole('option', { name: 'Fiançailles' }).click();
  await page.getByLabel('Date').fill(eventDate);
  await page.getByLabel('Début').fill('19:30');
  await page.getByLabel('Nombre d’invités').fill('80');
  await page.getByLabel('Adresse', { exact: true }).fill('12, rue des Orangers');
  await page.getByLabel('Ville').fill('Casablanca');
  await expect(page.getByTestId('availability')).toBeVisible();

  // 1. Formule (par personne : 80)
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('menuitem', { name: 'Formule' }).click();
  await page.getByRole('option', { name: /Formule Fiançailles/ }).click();
  // 2. Plat du catalogue
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('menuitem', { name: 'Plat' }).click();
  await page.getByPlaceholder('Rechercher…').fill('jus');
  await page.getByRole('option', { name: /Jus de fruits frais/ }).click();
  // 3. Ligne libre
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('menuitem', { name: 'Ligne libre' }).click();
  const custom = page.getByTestId('order-lines').getByRole('listitem').nth(2);
  await custom.getByLabel('Libellé').fill('Décoration de table');
  await custom.getByLabel('Prix unitaire TTC').fill('1500');

  await expect(page.getByTestId('order-lines').getByRole('listitem')).toHaveCount(3);
  await expect(
    page.getByTestId('order-lines').getByRole('listitem').first().getByLabel('Quantité'),
  ).toHaveValue('80');
  // 80 × 250,00 + 80 × 15,00 + 1 500,00 = 22 700,00 TTC, calculé en direct
  await expect(page.getByTestId('order-total-ttc')).toHaveText(/22\.700,00/);

  // Jour complet ou bloqué : le traiteur décide de passer outre (à la création comme à la confirmation)
  const force = page.getByRole('button', { name: 'Passer outre et enregistrer' });
  const forceIfAsked = async (done: ReturnType<typeof page.getByText>) => {
    await expect(force.or(done).first()).toBeVisible();
    if (await force.isVisible()) await force.click();
    await expect(done).toBeVisible();
  };

  await page.getByRole('button', { name: 'Enregistrer (en attente)' }).click();
  await forceIfAsked(page.getByText(/Commande CMD-\d{4}-\d{5} enregistrée/));
  await expect(page.getByRole('heading', { level: 1, name: /^CMD-/ })).toBeVisible();
  await expect(page.getByTestId('status-actions')).toBeVisible();

  // ─── Confirmation depuis la fiche (machine à états) ───
  await page.getByTestId('status-actions').getByRole('button', { name: 'Confirmer' }).click();
  await forceIfAsked(page.getByText('Statut mis à jour : Confirmée'));
  await expect(
    page.getByTestId('status-actions').getByRole('button', { name: 'Démarrer la préparation' }),
  ).toBeVisible();
  await expect(page.getByTestId('detail-lines').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('detail-total-ttc')).toHaveText(/22\.700,00/);
  const reference = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
  await expect(page.getByTestId('order-history')).toContainText('En attente → Confirmée');
  await expect(page.getByTestId('order-history')).toContainText('Commande créée — En attente');

  // ─── Calendrier : la commande apparaît le jour de l'événement ───
  await page.getByRole('link', { name: 'Calendrier' }).first().click();
  const [year, month] = eventDate.split('-').map(Number);
  const title = page.getByTestId('calendar-title');
  for (let step = 0; step < 4; step += 1) {
    if ((await title.textContent())?.includes(`${MONTHS[(month ?? 1) - 1]} ${year}`)) break;
    await page.getByRole('button', { name: 'Période suivante' }).click();
  }
  await expect(title).toContainText(`${MONTHS[(month ?? 1) - 1]} ${year}`);
  const day = page.getByTestId(`day-${eventDate}`);
  await expect(
    day.getByTestId('calendar-order').filter({ hasText: 'Yasmine' }).first(),
  ).toBeVisible();

  // Le panneau du jour liste la commande, avec sa référence
  await day.click({ position: { x: 18, y: 16 } });
  await expect(page.getByTestId('day-orders')).toContainText(reference);
});
