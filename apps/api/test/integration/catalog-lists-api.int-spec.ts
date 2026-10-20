import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DEFAULT_EVENT_TYPES } from '@traiteur/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

/**
 * Listes gérables du catalogue (types d'événement, gammes) : listes par défaut créées par la base
 * pour chaque traiteur, codes stables, archivage, suppression d'un élément inutilisé, commandes
 * reliées au type de leur traiteur, droits et isolation.
 */
interface Actor {
  token: string;
  traiteurId: string;
}

interface Item {
  id: string;
  code: string;
  name: { fr: string; ar?: string };
  description: { fr: string } | null;
  sortOrder: number;
  isActive: boolean;
  archived: boolean;
  usageCount: number;
}

describe('API des listes du catalogue (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let driver: Actor;
  let otherAdmin: Actor;
  let clientId: string;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
      patch: (path: string, body: object) =>
        auth(request(server()).patch(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(request(server()).delete(`/api/v1${path}`)),
    };
  };

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `listes-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: role,
        lastName: 'Test',
      },
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

  const items = async (actor: Actor, list: string) =>
    (await api(actor).get(`/catalog/lists/${list}`).expect(200)).body as Item[];

  const createOrder = (eventType: string, offset: number) =>
    api(admin).post('/orders', {
      clientId,
      eventType,
      eventDate: casablancaDay(offset),
      startTime: '20:00',
      endTime: '23:30',
      endsNextDay: false,
      guestCount: 80,
      venueName: null,
      venueAddress: '8, avenue Hassan II',
      city: 'Casablanca',
      notes: null,
      internalNotes: null,
      status: 'PENDING',
      forceAvailability: true,
      lines: [
        {
          itemType: 'CUSTOM',
          label: { fr: 'Menu', ar: 'قائمة' },
          quantity: 80,
          unitPrice: 20_000,
          taxRateBps: 2000,
          perPerson: true,
        },
      ],
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
    driver = await actorFor(traiteurId, 'LIVREUR');
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
    const client = await api(admin)
      .post('/clients', {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: 'Salma',
        lastName: 'Bennani',
        email: null,
        locale: 'fr',
        tags: [],
        internalNotes: null,
        address: null,
      })
      .expect(201);
    clientId = (client.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('tout nouveau traiteur reçoit ses types d’événement (dont la soutenance) et ses gammes', async () => {
    const types = await items(admin, 'event-types');
    expect(types.map((item) => item.code)).toEqual([...DEFAULT_EVENT_TYPES]);
    expect(types.find((item) => item.code === 'THESIS')?.name).toEqual({
      fr: 'Soutenance',
      ar: 'مناقشة أطروحة',
    });
    const ranges = await items(admin, 'ranges');
    expect(ranges.map((item) => item.code)).toEqual(['STANDARD', 'PREMIUM', 'LUXE']);
  });

  it('nouveau type : code stable, commande reliée, nom traduit dans les réponses', async () => {
    const created = (
      await api(admin)
        .post('/catalog/lists/event-types', {
          name: { fr: 'Henné', ar: 'حناء' },
          description: null,
          isActive: true,
        })
        .expect(201)
    ).body as Item;
    expect(created).toMatchObject({ code: 'HENNE', usageCount: 0, archived: false });
    const twin = (
      await api(admin)
        .post('/catalog/lists/event-types', {
          name: { fr: 'Henné' },
          description: null,
          isActive: true,
        })
        .expect(201)
    ).body as Item;
    expect(twin.code).toBe('HENNE_2');

    const order = (await createOrder('HENNE', 50).expect(201)).body as {
      id: string;
      eventType: string;
      eventTypeName: { fr: string; ar: string };
    };
    expect(order).toMatchObject({ eventType: 'HENNE', eventTypeName: { fr: 'Henné', ar: 'حناء' } });

    // Renommer ne change pas le code ni les commandes
    await api(admin)
      .patch(`/catalog/lists/event-types/${created.id}`, {
        name: { fr: 'Soirée du henné', ar: 'ليلة الحناء' },
        description: null,
        isActive: true,
      })
      .expect(200);
    const detail = (await api(admin).get(`/orders/${order.id}`).expect(200)).body as {
      eventType: string;
      eventTypeName: { fr: string };
    };
    expect(detail).toMatchObject({ eventType: 'HENNE', eventTypeName: { fr: 'Soirée du henné' } });

    // Utilisé : suppression refusée, archivage possible ; plus proposé aux nouvelles commandes
    expect(
      (await api(admin).delete(`/catalog/lists/event-types/${created.id}`).expect(409)).body,
    ).toMatchObject({ code: 'CATALOG_LIST_IN_USE' });
    await api(admin).post(`/catalog/lists/event-types/${created.id}/archive`).expect(200);
    expect((await createOrder('HENNE', 51).expect(400)).body).toMatchObject({
      code: 'EVENT_TYPE_UNAVAILABLE',
    });
    expect((await createOrder('INCONNU', 51).expect(400)).body).toMatchObject({
      code: 'EVENT_TYPE_UNAVAILABLE',
    });
    // La commande existante garde son type archivé
    await api(admin).get(`/orders/${order.id}`).expect(200);
    await api(admin).post(`/catalog/lists/event-types/${created.id}/restore`).expect(200);

    // Jamais utilisé : supprimable
    await api(admin).delete(`/catalog/lists/event-types/${twin.id}`).expect(204);
    const after = await items(admin, 'event-types');
    expect(after.find((item) => item.code === 'HENNE')?.usageCount).toBe(1);
    expect(after.some((item) => item.code === 'HENNE_2')).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { traiteurId: admin.traiteurId, entityType: 'EventType', entityId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      'catalog.event_type.created',
      'catalog.event_type.updated',
      'catalog.event_type.archived',
      'catalog.event_type.restored',
    ]);
  });

  it('garde au moins un type disponible ; ordre d’affichage', async () => {
    const types = await items(admin, 'event-types');
    const [first, ...rest] = types.filter((item) => !item.archived && item.isActive);
    for (const item of rest) {
      await api(admin).post(`/catalog/lists/event-types/${item.id}/archive`).expect(200);
    }
    expect(
      (
        await api(admin)
          .post(`/catalog/lists/event-types/${first?.id ?? ''}/archive`)
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'CATALOG_LIST_LAST_ITEM' });
    for (const item of rest) {
      await api(admin).post(`/catalog/lists/event-types/${item.id}/restore`).expect(200);
    }

    const reversed = types.map((item) => item.id).reverse();
    const reordered = (
      await api(admin).put('/catalog/lists/event-types/order', { ids: reversed }).expect(200)
    ).body as Item[];
    expect(reordered.map((item) => item.id)).toEqual(reversed);
  });

  it('gammes : description traduite, création et suppression', async () => {
    const created = (
      await api(admin)
        .post('/catalog/lists/ranges', {
          name: { fr: 'Prestige', ar: 'بريستيج' },
          description: { fr: 'Service à l’assiette, vaisselle fine' },
          isActive: true,
        })
        .expect(201)
    ).body as Item;
    expect(created).toMatchObject({
      code: 'PRESTIGE',
      description: { fr: 'Service à l’assiette, vaisselle fine' },
    });
    await api(admin).delete(`/catalog/lists/ranges/${created.id}`).expect(204);
  });

  it('droits : lecture pour l’employé, écriture pour l’administrateur seulement', async () => {
    await api(employee).get('/catalog/lists/event-types').expect(200);
    await api(employee)
      .post('/catalog/lists/event-types', {
        name: { fr: 'Baptême' },
        description: null,
        isActive: true,
      })
      .expect(403);
    await api(driver).get('/catalog/lists/ranges').expect(403);
    await api(admin).get('/catalog/lists/inconnue').expect(400);
  });

  it('isolation : un traiteur ne voit ni ne modifie les listes d’un autre', async () => {
    const mine = await items(admin, 'event-types');
    const target = mine[0];
    await api(otherAdmin)
      .patch(`/catalog/lists/event-types/${target?.id ?? ''}`, {
        name: { fr: 'Piraté' },
        description: null,
        isActive: true,
      })
      .expect(404);
    const theirs = await items(otherAdmin, 'event-types');
    expect(theirs.some((item) => item.id === target?.id)).toBe(false);
    // Un type d'un autre traiteur n'est pas accepté par la base
    await expect(
      prisma.order.updateMany({
        where: { traiteurId: otherAdmin.traiteurId },
        data: { eventType: 'HENNE' },
      }),
    ).resolves.toMatchObject({ count: 0 });
    const order = await prisma.order.findFirstOrThrow({ where: { traiteurId: admin.traiteurId } });
    await expect(
      prisma.order.update({ where: { id: order.id }, data: { eventType: 'N_EXISTE_PAS' } }),
    ).rejects.toThrow();
  });
});
