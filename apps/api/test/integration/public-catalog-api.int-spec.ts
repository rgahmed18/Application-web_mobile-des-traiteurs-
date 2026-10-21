import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Catalogue public (site client) : sans connexion, lecture seule, seulement les éléments actifs
 * et non archivés, prix TTC, jamais de stock ni de prix de remplacement ou HT.
 */
interface Actor {
  token: string;
  traiteurId: string;
}

interface PublicCatalogBody {
  currency: string;
  menus: { name: { fr: string }; eventTypes: string[]; range: { code: string } | null }[];
  buffets: {
    name: { fr: string };
    priceTtc: number;
    type: { code: string } | null;
    freeItems: { fr: string }[];
  }[];
  equipment: { name: { fr: string }; priceTtc: number; category: { code: string } | null }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Catalogue public (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let slug: string;

  const server = (): App => app.getHttpServer() as App;
  const publicGet = (path: string) => request(server()).get(`/api/v1/public/traiteurs/${path}`);
  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body),
  });

  async function createTraiteur(prefix: string) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `${prefix}-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        isVatRegistered: true,
        defaultTaxRateBps: 2000,
      },
    });
  }

  const listId = async (list: string, code: string) =>
    (
      (await api(admin).get(`/catalog/lists/${list}`).expect(200)).body as {
        id: string;
        code: string;
      }[]
    ).find((item) => item.code === code)?.id ?? '';

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteur = await createTraiteur('public');
    slug = traiteur.slug;
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Karim', lastName: 'Admin' },
    });
    const membership = await prisma.membership.create({
      data: {
        traiteurId: traiteur.id,
        userId: user.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'Karim',
        lastName: 'Admin',
      },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId: traiteur.id, membershipId: membership.id, role: 'ADMIN_TRAITEUR' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    admin = { token: issued.accessToken, traiteurId: traiteur.id };

    // Catalogue : un plat, trois menus (soutenance premium, tous événements, archivé), un buffet,
    // du matériel actif et désactivé
    const dish = (
      (
        await api(admin)
          .post('/catalog/dishes', {
            name: { fr: 'Pastilla', ar: 'بسطيلة' },
            description: null,
            categoryId: null,
            price: 4_500,
            taxRateBps: null,
            unit: 'PER_PERSON',
            minQuantity: 1,
            allergens: [],
            imageKey: null,
            isAvailable: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    const menu = (name: string, extra: Record<string, unknown>) =>
      api(admin)
        .post('/catalog/packages', {
          name: { fr: name },
          description: null,
          pricePerPerson: 30_000,
          taxRateBps: null,
          minGuests: 10,
          maxGuests: null,
          imageKey: null,
          isActive: true,
          dishes: [{ dishId: dish, quantity: 1 }],
          rangeId: null,
          eventTypeIds: [],
          ...extra,
        })
        .expect(201);
    await menu('Menu soutenance', {
      rangeId: await listId('ranges', 'PREMIUM'),
      eventTypeIds: [await listId('event-types', 'THESIS')],
    });
    await menu('Menu tous événements', {});
    const archived = (await menu('Menu archivé', {})).body as { id: string };
    await api(admin).post(`/catalog/packages/${archived.id}/archive`).expect(200);
    await menu('Menu désactivé', { isActive: false });

    await api(admin)
      .post('/catalog/buffets', {
        name: { fr: 'Buffet thé' },
        description: null,
        typeId: await listId('buffet-types', 'TEA'),
        rangeId: null,
        pricingUnit: 'FLAT',
        price: 250_000,
        taxRateBps: null,
        minGuests: 1,
        imageKey: null,
        isActive: true,
        dishes: [],
        freeItems: [{ fr: 'Thé à la menthe', ar: 'أتاي' }],
      })
      .expect(201);
    const equipment = (name: string, isActive: boolean) =>
      api(admin)
        .post('/catalog/equipment', {
          name: { fr: name },
          description: null,
          categoryId: null,
          rangeId: null,
          price: 1_500,
          replacementPrice: 45_000,
          taxRateBps: null,
          stockQuantity: 200,
          imageKey: null,
          isActive,
        })
        .expect(201);
    await equipment('Chaise Napoléon', true);
    await equipment('Chaise abîmée', false);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('options : types d’événement (dont la soutenance) et gammes, sans connexion', async () => {
    const response = await publicGet(`${slug}/catalog/options`).expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    const body = response.body as {
      eventTypes: { code: string }[];
      ranges: { code: string; description: unknown }[];
    };
    expect(body.eventTypes.map((item) => item.code)).toContain('THESIS');
    expect(body.ranges.map((item) => item.code)).toEqual(['STANDARD', 'PREMIUM', 'LUXE']);
  });

  it('catalogue : éléments publiés seulement, prix TTC, ni stock ni prix de remplacement', async () => {
    const response = await publicGet(`${slug}/catalog`).expect(200);
    const body = response.body as PublicCatalogBody;
    expect(body.menus.map((item) => item.name.fr).sort()).toEqual([
      'Menu soutenance',
      'Menu tous événements',
    ]);
    expect(body.buffets).toEqual([
      expect.objectContaining({
        name: { fr: 'Buffet thé' },
        priceTtc: 250_000,
        pricingUnit: 'FLAT',
        freeItems: [{ fr: 'Thé à la menthe', ar: 'أتاي' }],
      }),
    ]);
    expect(body.buffets[0]?.type?.code).toBe('TEA');
    expect(body.equipment.map((item) => [item.name.fr, item.priceTtc])).toEqual([
      ['Chaise Napoléon', 1_500],
    ]);
    const raw = JSON.stringify(body);
    for (const hidden of ['stock', 'replacement', 'priceHt', 'pricePerPersonHt', 'archived']) {
      expect(raw).not.toContain(hidden);
    }
  });

  it('filtres par type d’événement et par gamme', async () => {
    const names = async (query: string) =>
      ((await publicGet(`${slug}/catalog?${query}`).expect(200)).body as PublicCatalogBody).menus
        .map((item) => item.name.fr)
        .sort();
    expect(await names('eventType=THESIS')).toEqual(['Menu soutenance', 'Menu tous événements']);
    expect(await names('eventType=WEDDING')).toEqual(['Menu tous événements']);
    const premium = (await publicGet(`${slug}/catalog?range=PREMIUM`).expect(200))
      .body as PublicCatalogBody;
    expect(premium.menus.map((item) => [item.name.fr, item.range?.code])).toEqual([
      ['Menu soutenance', 'PREMIUM'],
    ]);
    expect(premium.buffets).toEqual([]);
    await publicGet(`${slug}/catalog?range=premium!`).expect(400);
  });

  it('traiteur inconnu, malformé ou suspendu : 404', async () => {
    await publicGet('inconnu-xyz/catalog').expect(404);
    await publicGet('Pas%20un%20slug/catalog/options').expect(404);
    const suspended = await createTraiteur('suspendu');
    await prisma.traiteur.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    await publicGet(`${suspended.slug}/catalog`).expect(404);
  });
});
