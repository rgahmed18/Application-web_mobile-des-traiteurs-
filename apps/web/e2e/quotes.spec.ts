import { expect, test } from '@playwright/test';

import { login, uniqueSuffix } from './helpers';

/** Jour civil à Casablanca, dans `offset` jours. */
function casablancaDay(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
}

test('devis envoyé par lien sécurisé, accepté en ligne, puis facture d’acompte et export', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = uniqueSuffix();
  const lastName = `Devis ${suffix}`;
  const phone = `07${String(Date.now()).slice(-8)}`;
  // Date lointaine et variable : jour libre, la commande se confirme à l'accord
  const eventDate = casablancaDay(200 + (Date.now() % 150));

  await login(page);

  // ─── Client et commande en attente (une ligne libre) ───
  await page.getByRole('link', { name: 'Clients' }).first().click();
  await page.getByRole('button', { name: 'Nouveau client' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Téléphone').fill(phone);
  await dialog.getByLabel('Prénom').fill('Salma');
  await dialog.getByLabel('Nom', { exact: true }).fill(lastName);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Client enregistré')).toBeVisible();

  await page.getByRole('link', { name: 'Nouvelle commande' }).click();
  await page.getByLabel('Type d’événement').click();
  await page.getByRole('option', { name: 'Mariage' }).click();
  await page.getByLabel('Date').fill(eventDate);
  await page.getByLabel('Début').fill('19:00');
  await page.getByLabel('Nombre d’invités').fill('100');
  await page.getByLabel('Adresse', { exact: true }).fill('8, avenue Hassan II');
  await page.getByLabel('Ville').fill('Casablanca');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('menuitem', { name: 'Ligne libre' }).click();
  const line = page.getByTestId('order-lines').getByRole('listitem').first();
  await line.getByLabel('Libellé (français)').fill('Prestation mariage');
  await line.getByLabel('Libellé en arabe (facultatif)').fill('خدمة حفل الزفاف');
  await line.getByLabel('Prix unitaire TTC').fill('10000');
  await page.getByRole('button', { name: 'Enregistrer (en attente)' }).click();
  await expect(page.getByText(/Commande CMD-\d{4}-\d{5} enregistrée/)).toBeVisible();

  // ─── Devis : brouillon, puis envoi (lien affiché une fois) ───
  const card = page.getByTestId('quotes-card');
  await card.getByRole('button', { name: 'Préparer un devis' }).click();
  await expect(page.getByText('Brouillon v1 préparé')).toBeVisible();
  await expect(card.getByTestId('quote-status')).toHaveText('Brouillon');
  await card.getByRole('button', { name: 'Envoyer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Envoyer' }).click();
  const linkInput = page.getByTestId('quote-link-url');
  await expect(linkInput).toHaveValue(/\/devis\/[A-Za-z0-9_-]{43}$/);
  const url = await linkInput.inputValue();
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/2127\d{8}\?text=Bonjour%20Salma/,
  );
  await page.getByRole('button', { name: 'Terminé' }).click();
  await expect(card.getByTestId('quote-status')).toHaveText('Envoyé');
  await expect(page.getByTestId('order-status')).toContainText('Devis envoyé');

  // ─── Page publique, sans session : jamais indexée, jeton jamais transmis ───
  const visitor = await browser.newContext();
  const client = await visitor.newPage();
  const response = await client.goto(url);
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(client.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(client.getByTestId('public-quote-total')).toHaveText(/10\.000,00/);
  await expect(client.getByTestId('public-quote-status')).toHaveText('En attente de votre réponse');

  await client.getByRole('button', { name: 'Accepter le devis' }).click();
  await client.getByLabel('Votre nom complet').fill(`Salma ${lastName}`);
  await client.getByLabel(/J’accepte ce devis/).check();
  await client.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(client.getByTestId('public-quote-outcome')).toContainText(
    'Votre accord est enregistré',
  );
  await visitor.close();

  // ─── Retour au back-office : commande confirmée, accord tracé ───
  await page.reload();
  await expect(page.getByTestId('quotes-card').getByTestId('quote-status')).toHaveText('Accepté');
  await expect(page.getByTestId('quotes-card')).toContainText(
    `Accepté en ligne par Salma ${lastName}`,
  );
  await expect(page.getByTestId('order-status')).toContainText('Confirmée');

  // ─── Facture d'acompte (30 % de 10 000,00), datée du jour, numéro définitif ───
  const invoices = page.getByTestId('invoices-card');
  await invoices.getByRole('button', { name: 'Facturer l’acompte' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('3.000,00');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Émettre la facture' }).click();
  await expect(page.getByText(/Facture FAC-\d{4}-\d{5} émise/)).toBeVisible();
  await expect(invoices.getByTestId('invoices-list')).toContainText('Facture d’acompte');
  await expect(invoices.getByRole('button', { name: 'Facturer le solde' })).toBeVisible();

  // ─── Page Factures : recherche et export CSV pour le comptable ───
  await page.getByRole('link', { name: 'Factures' }).first().click();
  await page.getByLabel('Recherche').fill(lastName);
  await expect(page.getByTestId('invoice-list').getByRole('listitem')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^factures_.*\.csv$/);
});
