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
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/** Buffets : types par défaut, composition en plats et éléments libres, gamme, tarification. */
interface Actor {
  token: string;
  traiteurId: string;
}

interface BuffetBody {
  id: string;
  pricingUnit: string;
  priceTtc: number;
  priceHt: number;
  type: { code: string } | null;
  range: { code: string } | null;
  dishes: { dishId: string; quantity: number }[];
  freeItems: { fr: string; ar?: string }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('API des buffets (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let otherAdmin: Actor;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(request(server()).delete(`/api/v1${path}`)),
    };
  };

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `buffets-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: role, lastName: 'Test' },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName: 'Test', lastName: role },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId };
  }

  const listItems = async (actor: Actor, list: string) =>
    (await api(actor).get(`/catalog/lists/${list}`).expect(200)).body as {
      id: string;
      code: string;
      usageCount: number;
    }[];
  const listId = async (list: string, code: string) =>
    (await listItems(admin, list)).find((item) => item.code === code)?.id ?? '';

  const newDish = async () =>
    (
      (
        await api(admin)
          .post('/catalog/dishes', {
            name: { fr: `Briouates ${randomUUID().slice(0, 6)}` },
            description: null,
            categoryId: null,
            price: 2_000,
            taxRateBps: null,
            unit: 'PER_PIECE',
            minQuantity: 1,
            allergens: [],
            imageKey: null,
            isAvailable: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;

  const buffetBody = (overrides: Record<string, unknown> = {}) => ({
    name: { fr: `Buffet marocain ${randomUUID().slice(0, 6)}`, ar: 'بوفيه مغربي' },
    description: null,
    typeId: null,
    rangeId: null,
    pricingUnit: 'PER_PERSON',
    price: 18_000,
    taxRateBps: null,
    minGuests: 30,
    imageKey: null,
    isActive: true,
    dishes: [],
    freeItems: [{ fr: 'Fruits secs', ar: 'فواكه جافة' }],
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);
    const traiteurId = await createTraiteur();
    admin = await actorFor(traiteurId, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteurId, 'EMPLOYE');
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('types de buffet par défaut', async () => {
    expect((await listItems(admin, 'buffet-types')).map((item) => item.code)).toEqual([
      'MOROCCAN',
      'ORIENTAL',
      'SWEET',
      'TEA',
    ]);
  });

  it('composition en plats et éléments libres, type, gamme, forfait ou par personne', async () => {
    const briouates = await newDish();
    const pastilla = await newDish();
    const created = (
      await api(admin)
        .post(
          '/catalog/buffets',
          buffetBody({
            typeId: await listId('buffet-types', 'MOROCCAN'),
            rangeId: await listId('ranges', 'PREMIUM'),
            dishes: [
              { dishId: briouates, quantity: 3 },
              { dishId: pastilla, quantity: 1 },
            ],
          }),
        )
        .expect(201)
    ).body as BuffetBody;
    expect(created).toMatchObject({
      pricingUnit: 'PER_PERSON',
      priceTtc: 18_000,
      priceHt: 15_000,
      type: { code: 'MOROCCAN' },
      range: { code: 'PREMIUM' },
      freeItems: [{ fr: 'Fruits secs', ar: 'فواكه جافة' }],
    });
    expect(created.dishes.map((line) => [line.dishId, line.quantity])).toEqual([
      [briouates, 3],
      [pastilla, 1],
    ]);

    // Forfait, éléments libres seulement ; filtre par type
    const tea = (
      await api(admin)
        .post(
          '/catalog/buffets',
          buffetBody({
            typeId: await listId('buffet-types', 'TEA'),
            pricingUnit: 'FLAT',
            price: 250_000,
            freeItems: [{ fr: 'Thé à la menthe' }, { fr: 'Msemen et beghrir' }],
          }),
        )
        .expect(201)
    ).body as BuffetBody;
    const ofType = async (code: string) =>
      (
        (
          await api(admin)
            .get(`/catalog/buffets?typeId=${await listId('buffet-types', code)}`)
            .expect(200)
        ).body as { items: { id: string }[] }
      ).items.map((item) => item.id);
    expect(await ofType('TEA')).toEqual([tea.id]);
    expect(await ofType('MOROCCAN')).toEqual([created.id]);

    // Utilisations : type et gamme portés, plat présent dans un buffet
    expect(
      (await listItems(admin, 'buffet-types')).find((item) => item.code === 'MOROCCAN')?.usageCount,
    ).toBe(1);
    await api(admin)
      .delete(`/catalog/lists/buffet-types/${await listId('buffet-types', 'MOROCCAN')}`)
      .expect(409);
    expect((await api(admin).delete(`/catalog/dishes/${pastilla}`).expect(409)).body).toMatchObject(
      { code: 'DISH_IN_PACKAGE' },
    );

    // Plat archivé : refusé à l'ajout, conservé s'il y est déjà
    await api(admin).post(`/catalog/dishes/${pastilla}/archive`).expect(200);
    const fresh = await newDish();
    await api(admin).post(`/catalog/dishes/${fresh}/archive`).expect(200);
    await api(admin)
      .put(
        `/catalog/buffets/${created.id}`,
        buffetBody({ dishes: [{ dishId: pastilla, quantity: 2 }] }),
      )
      .expect(200);
    expect(
      (
        await api(admin)
          .put(
            `/catalog/buffets/${created.id}`,
            buffetBody({ dishes: [{ dishId: fresh, quantity: 1 }] }),
          )
          .expect(400)
      ).body,
    ).toMatchObject({ code: 'ITEM_ARCHIVED' });

    // Buffet vide refusé ; suppression
    await api(admin)
      .post('/catalog/buffets', buffetBody({ freeItems: [] }))
      .expect(400);
    await api(admin).delete(`/catalog/buffets/${tea.id}`).expect(204);
  });

  it('droits et isolation', async () => {
    const buffet = (await api(admin).post('/catalog/buffets', buffetBody()).expect(201))
      .body as BuffetBody;
    await api(employee).get(`/catalog/buffets/${buffet.id}`).expect(200);
    await api(employee).post('/catalog/buffets', buffetBody()).expect(403);
    await api(otherAdmin).get(`/catalog/buffets/${buffet.id}`).expect(404);
    const myDish = await newDish();
    await api(otherAdmin)
      .post('/catalog/buffets', buffetBody({ dishes: [{ dishId: myDish, quantity: 1 }] }))
      .expect(404);
  });
});
