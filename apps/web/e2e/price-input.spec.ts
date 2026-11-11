import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { apiLogin, login, uniqueSuffix } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1';

type Locale = 'fr' | 'ar';
type Mode = 'TTC' | 'HT';

/** Libellés de l'interface, lus dans les messages (mêmes parcours en français et en arabe). */
function messages(locale: Locale) {
  const all = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'messages', `${locale}.json`), 'utf8'),
  ) as {
    common: { save: string };
    catalog: { services: { new: string } };
    drafts: { resume: string };
  };
  return {
    save: all.common.save,
    newService: all.catalog.services.new,
    resume: all.drafts.resume,
  };
}

async function useLocale(page: Page, locale: Locale) {
  const url = new URL(page.url());
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: url.origin }]);
}

/** Une seule connexion API par test (jeton valable 15 minutes). */
const sessions = new WeakMap<APIRequestContext, Promise<{ Authorization: string }>>();
function auth(api: APIRequestContext): Promise<{ Authorization: string }> {
  let session = sessions.get(api);
  if (!session) {
    session = apiLogin(api);
    sessions.set(api, session);
  }
  return session;
}

/** Brouillons de création laissés par un essai précédent : ils verrouilleraient les formulaires. */
async function clearNewDrafts(api: APIRequestContext) {
  const headers = await auth(api);
  for (const form of ['dish', 'package', 'buffet', 'equipment', 'service']) {
    await api.delete(`${API}/me/drafts/${form}:new`, { headers });
  }
}

async function setPriceMode(api: APIRequestContext, mode: Mode) {
  const headers = await auth(api);
  const response = await api.put(`${API}/settings/pricing`, {
    headers,
    data: { priceEntryMode: mode },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Saisie au clavier, comme une personne : clic dans le champ puis frappe. */
async function typeInto(page: Page, selector: string, text: string) {
  await page.locator(selector).click();
  await page.keyboard.type(text, { delay: 40 });
}

/** Élément enregistré, retrouvé par son nom (suffixe unique). */
async function findByName<T extends { id: string; name: { fr: string } }>(
  api: APIRequestContext,
  path: string,
  name: string,
): Promise<T> {
  const headers = await auth(api);
  const search = path === 'services' ? '' : `?search=${encodeURIComponent(name)}&pageSize=100`;
  const body = (await (await api.get(`${API}/catalog/${path}${search}`, { headers })).json()) as
    T[] | { items: T[] };
  const items = Array.isArray(body) ? body : body.items;
  const item = items.find((candidate) => candidate.name.fr === name);
  if (!item) throw new Error(`${path} « ${name} » introuvable`);
  return item;
}

async function firstDishId(api: APIRequestContext): Promise<string> {
  const headers = await auth(api);
  const { items } = (await (
    await api.get(`${API}/catalog/dishes?pageSize=1`, { headers })
  ).json()) as {
    items: { id: string }[];
  };
  if (!items[0]) throw new Error('aucun plat dans la démonstration');
  return items[0].id;
}

const price = (mode: Mode) => (mode === 'TTC' ? 'priceTtc' : 'priceHt');

for (const locale of ['fr', 'ar'] as const) {
  for (const mode of ['TTC', 'HT'] as const) {
    test(`prix tapés au clavier (${locale}, ${mode}) : plat, menu, buffet, matériel et service enregistrés tels quels`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      const t = messages(locale);
      const suffix = `${uniqueSuffix()}${locale}${mode}`;
      await clearNewDrafts(request);
      await setPriceMode(request, mode);
      try {
        await login(page);
        await useLocale(page, locale);
        const save = () =>
          page.locator('button[type="submit"]').filter({ hasText: t.save }).last().click();

        // Plat : création (« 10,50 »), puis modification d'un prix déjà rempli (« 12 » remplace)
        const dishName = `Prix plat ${suffix}`;
        await page.goto('/admin/catalog/dishes/new');
        await typeInto(page, '#field-name-fr', dishName);
        await typeInto(page, '#field-price', '10,50');
        await expect(page.locator('#field-price')).toHaveAttribute('autocomplete', 'off');
        await expect(page.locator('#field-minQuantity')).toHaveAttribute('autocomplete', 'off');
        await save();
        await expect(page).toHaveURL(/\/admin\/catalog\/dishes$/);
        const dish = await findByName<{
          id: string;
          name: { fr: string };
          priceTtc: number;
          priceHt: number;
        }>(request, 'dishes', dishName);
        expect(dish[price(mode)]).toBe(1050);
        await page.goto(`/admin/catalog/dishes/${dish.id}`);
        await expect(page.locator('#field-price')).toHaveValue('10,50');
        await typeInto(page, '#field-price', '12');
        await expect(page.locator('#field-price')).toHaveValue('12');
        await save();
        await expect(page).toHaveURL(/\/admin\/catalog\/dishes$/);
        expect((await findByName<typeof dish>(request, 'dishes', dishName))[price(mode)]).toBe(
          1200,
        );

        // Matériel : location « 10 », remplacement « 20 », stock
        const equipmentName = `Prix matériel ${suffix}`;
        await page.goto('/admin/catalog/equipment/new');
        await typeInto(page, '#field-name-fr', equipmentName);
        await typeInto(page, '#field-price', '10');
        await typeInto(page, '#field-replacementPrice', '20');
        await expect(page.locator('#field-replacementPrice')).toHaveAttribute(
          'autocomplete',
          'off',
        );
        await expect(page.locator('#field-stockQuantity')).toHaveAttribute('autocomplete', 'off');
        await typeInto(page, '#field-stockQuantity', '50');
        await expect(page.locator('#field-stockQuantity')).toHaveValue('50');
        await save();
        await expect(page).toHaveURL(/\/admin\/catalog\/equipment$/);
        const equipment = await findByName<{
          id: string;
          name: { fr: string };
          priceTtc: number;
          priceHt: number;
          replacementPriceTtc: number;
          replacementPriceHt: number;
          stockQuantity: number;
        }>(request, 'equipment', equipmentName);
        expect(equipment[price(mode)]).toBe(1000);
        expect(equipment[mode === 'TTC' ? 'replacementPriceTtc' : 'replacementPriceHt']).toBe(2000);
        expect(equipment.stockQuantity).toBe(50);

        // Service : fenêtre de création, « 1500 »
        const serviceName = `Prix service ${suffix}`;
        await page.goto('/admin/catalog/services');
        await page.getByRole('button', { name: t.newService }).first().click();
        const dialog = page.getByRole('dialog');
        await typeInto(page, '#field-name-fr', serviceName);
        await typeInto(page, '#field-price', '1500');
        await dialog.locator('button[type="submit"]').click();
        await expect(dialog).toHaveCount(0);
        const service = await findByName<{
          id: string;
          name: { fr: string };
          priceTtc: number;
          priceHt: number;
        }>(request, 'services', serviceName);
        expect(service[price(mode)]).toBe(150_000);

        // Menu et buffet : créés avec un prix, puis prix modifié au clavier dans le formulaire
        const headers = await auth(request);
        const dishId = await firstDishId(request);
        const packageName = `Prix menu ${suffix}`;
        const created = await request.post(`${API}/catalog/packages`, {
          headers,
          data: {
            name: { fr: packageName },
            description: null,
            pricePerPerson: 99_900,
            taxRateBps: null,
            minGuests: 1,
            maxGuests: null,
            imageKey: null,
            isActive: true,
            dishes: [{ dishId, quantity: 1 }],
            rangeId: null,
            eventTypeIds: [],
          },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const pkg = (await created.json()) as { id: string };
        await page.goto(`/admin/catalog/packages/${pkg.id}`);
        await expect(page.locator('#field-pricePerPerson')).toHaveValue('999,00');
        await typeInto(page, '#field-pricePerPerson', '10,50');
        await expect(page.locator('#field-pricePerPerson')).toHaveValue('10,50');
        await save();
        await expect(page).toHaveURL(/\/admin\/catalog\/packages$/);
        const savedPackage = await findByName<{
          id: string;
          name: { fr: string };
          pricePerPersonTtc: number;
          pricePerPersonHt: number;
        }>(request, 'packages', packageName);
        expect(savedPackage[mode === 'TTC' ? 'pricePerPersonTtc' : 'pricePerPersonHt']).toBe(1050);

        const buffetName = `Prix buffet ${suffix}`;
        const createdBuffet = await request.post(`${API}/catalog/buffets`, {
          headers,
          data: {
            name: { fr: buffetName },
            description: null,
            typeId: null,
            rangeId: null,
            pricingUnit: 'PER_PERSON',
            price: 99_900,
            taxRateBps: null,
            minGuests: 1,
            imageKey: null,
            isActive: true,
            dishes: [],
            freeItems: [{ fr: 'Fruits secs' }],
          },
        });
        expect(createdBuffet.ok(), await createdBuffet.text()).toBe(true);
        const buffet = (await createdBuffet.json()) as { id: string };
        await page.goto(`/admin/catalog/buffets/${buffet.id}`);
        await expect(page.locator('#field-price')).toHaveValue('999,00');
        await typeInto(page, '#field-price', '1500');
        await expect(page.locator('#field-price')).toHaveValue('1500');
        await save();
        await expect(page).toHaveURL(/\/admin\/catalog\/buffets$/);
        const savedBuffet = await findByName<{
          id: string;
          name: { fr: string };
          priceTtc: number;
          priceHt: number;
        }>(request, 'buffets', buffetName);
        expect(savedBuffet[price(mode)]).toBe(150_000);
      } finally {
        await setPriceMode(request, 'TTC');
      }
    });
  }

  test(`brouillon repris puis nouvelle saisie (${locale}) : valeurs reprises affichées avant la frappe, jamais ajoutées`, async ({
    page,
    request,
  }) => {
    const t = messages(locale);
    const name = `Brouillon prix ${uniqueSuffix()}${locale}`;
    const headers = await auth(request);
    await clearNewDrafts(request);
    await login(page);
    await useLocale(page, locale);

    // Première tentative abandonnée : brouillon enregistré avec « 10 »
    await page.goto('/admin/catalog/equipment/new');
    await typeInto(page, '#field-name-fr', name);
    await typeInto(page, '#field-price', '10');
    await expect(page.getByTestId('draft-status')).toBeVisible();
    await expect
      .poll(async () => (await request.get(`${API}/me/drafts/equipment:new`, { headers })).status())
      .toBe(200);
    // Liste affichée avant de rouvrir le formulaire (navigation interrompue en plein
    // renouvellement de session : session fermée par sécurité)
    await page.goto('/admin/catalog/equipment');
    await expect(page.getByTestId('equipment-list')).toBeVisible();

    // Nouvelle création : brouillon proposé, champs verrouillés tant qu'on n'a pas choisi
    await page.goto('/admin/catalog/equipment/new');
    const banner = page.getByTestId('draft-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('draft-fields')).toHaveAttribute('data-locked', 'true');
    await expect(page.locator('#field-price')).toHaveValue('');

    // Reprise : la valeur reprise est affichée et signalée avant toute frappe
    await banner.getByRole('button', { name: t.resume }).click();
    await expect(page.getByTestId('draft-fields')).not.toHaveAttribute('data-locked');
    await expect(page.getByTestId('draft-restored')).toBeVisible();
    await expect(page.locator('#field-price')).toHaveValue('10');
    await expect(
      page.locator('[data-restored]').filter({ has: page.locator('#field-price') }),
    ).toHaveCount(1);

    // Nouvelle saisie dans le champ repris : elle remplace la valeur (« 10 », jamais « 1010 »)
    await typeInto(page, '#field-price', '10');
    await expect(page.locator('#field-price')).toHaveValue('10');
    await page.locator('button[type="submit"]').filter({ hasText: t.save }).last().click();
    await expect(page).toHaveURL(/\/admin\/catalog\/equipment$/);
    const saved = await findByName<{ id: string; name: { fr: string }; priceTtc: number }>(
      request,
      'equipment',
      name,
    );
    expect(saved.priceTtc).toBe(1000);
    await expect
      .poll(async () => (await request.get(`${API}/me/drafts/equipment:new`, { headers })).status())
      .toBe(404);
  });
}
