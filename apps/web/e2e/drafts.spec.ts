import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { apiLogin, login, uniqueSuffix } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

/** Un plat du traiteur de démonstration, sans brouillon en cours. */
async function dishWithoutDraft(api: APIRequestContext): Promise<{ id: string; name: string }> {
  const headers = await apiLogin(api);
  const response = await api.get(`${API}/catalog/dishes?pageSize=1`, { headers });
  const { items } = (await response.json()) as { items: { id: string; name: { fr: string } }[] };
  const dish = items[0];
  if (!dish) throw new Error('aucun plat dans la démonstration');
  await api.delete(`${API}/me/drafts/dish:${dish.id}`, { headers });
  return { id: dish.id, name: dish.name.fr };
}

async function typeName(page: Page, name: string) {
  await page.getByLabel('Nom (français)').fill(name);
  await expect(page.getByTestId('draft-status')).toContainText('Brouillon enregistré à');
}

test.describe('Brouillons des formulaires', () => {
  test('déconnexion dans un autre onglet en pleine saisie : brouillon repris après reconnexion', async ({
    page,
    context,
    request,
  }) => {
    const dish = await dishWithoutDraft(request);
    const draftName = `Brouillon ${uniqueSuffix()}`;
    await login(page);
    await page.goto(`/admin/catalog/dishes/${dish.id}`);
    // Saisie non encore enregistrée (moins de 3 s) : la fin de session l'enregistre d'abord
    await page.getByLabel('Nom (français)').fill(draftName);

    const other = await context.newPage();
    await other.goto('/admin');
    await other.getByRole('button', { name: 'Mon compte' }).click();
    await other.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await other.close();

    await login(page);
    // Tableau de bord : le brouillon à reprendre
    const card = page.getByTestId('drafts-card');
    await expect(card).toContainText(draftName);
    await card.getByRole('link', { name: 'Reprendre' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/dishes/${dish.id}`));

    const banner = page.getByTestId('draft-banner');
    await expect(banner).toContainText(
      /Vous avez un brouillon non terminé du \d{2}\/\d{2} à \d{2}:\d{2}/,
    );
    await expect(page.getByTestId('draft-conflict')).toHaveCount(0);
    await banner.getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByLabel('Nom (français)')).toHaveValue(draftName);

    // On revient à la valeur d'origine (la démonstration reste intacte) et on enregistre :
    // le brouillon disparaît
    await page.getByLabel('Nom (français)').fill(dish.name);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/enregistré/i).first()).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: /^Bonjour/ })).toBeVisible();
    await expect(page.getByTestId('drafts-card')).toHaveCount(0);
  });

  test('élément modifié par quelqu’un d’autre : conflit signalé, brouillon supprimable', async ({
    page: editor,
    context,
    request,
  }) => {
    const dish = await dishWithoutDraft(request);
    await login(editor);
    await editor.goto(`/admin/catalog/dishes/${dish.id}`);
    await typeName(editor, `Conflit ${uniqueSuffix()}`);

    // Une autre personne modifie le plat entre-temps
    const headers = await apiLogin(request);
    expect((await request.post(`${API}/catalog/dishes/${dish.id}/archive`, { headers })).ok()).toBe(
      true,
    );
    expect((await request.post(`${API}/catalog/dishes/${dish.id}/restore`, { headers })).ok()).toBe(
      true,
    );

    // Le formulaire rouvert (autre onglet : celui-ci a une saisie en cours)
    const page = await context.newPage();
    await page.goto(`/admin/catalog/dishes/${dish.id}`);
    await expect(page.getByTestId('draft-banner')).toBeVisible();
    await expect(page.getByTestId('draft-conflict')).toContainText(
      'cet élément a été modifié depuis votre brouillon',
    );
    // Rien n'est écrasé : le formulaire montre la version actuelle tant qu'on ne reprend pas
    await expect(page.getByLabel('Nom (français)')).toHaveValue(dish.name);
    await page.getByTestId('draft-banner').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('draft-banner')).toHaveCount(0);
    await expect
      .poll(async () =>
        (await request.get(`${API}/me/drafts/dish:${dish.id}`, { headers })).status(),
      )
      .toBe(404);
  });

  test('une seule requête après la saisie, jamais une par frappe', async ({
    page,
    context,
    request,
  }) => {
    const dish = await dishWithoutDraft(request);
    const saves: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/me/drafts/')) saves.push(req.url());
    });
    await login(page);
    await page.goto(`/admin/catalog/dishes/${dish.id}`);
    await page.getByLabel('Nom (français)').pressSequentially('Saisie rapide', { delay: 40 });
    await expect(page.getByTestId('draft-status')).toContainText('Brouillon enregistré à');
    expect(saves).toHaveLength(1);

    // Nettoyage : supprimé depuis le tableau de bord (autre onglet : saisie en cours ici)
    const dashboard = await context.newPage();
    await dashboard.goto('/admin');
    const card = dashboard.getByTestId('drafts-card');
    await card
      .getByRole('button', { name: /^Supprimer/ })
      .first()
      .click();
    await expect(card).toHaveCount(0);
  });
});
