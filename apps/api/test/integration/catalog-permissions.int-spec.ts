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

/**
 * Écriture du catalogue réservée à l'administrateur du traiteur et au super-admin :
 * permission catalog.write verrouillée (aucune dérogation possible), chaque route d'écriture
 * testée pour chaque rôle, modifications du super-admin tracées dans l'audit.
 */
interface Actor {
  token: string;
  userId: string;
}

type Method = 'post' | 'put' | 'patch' | 'delete';

/** Une opération d'écriture ; `prepare` crée, avec l'administrateur, ce dont elle a besoin. */
interface WriteOperation {
  name: string;
  method: Method;
  path: (ids: Record<string, string>) => string;
  body?: () => object;
  prepare?: () => Promise<Record<string, string>>;
}

describe('Catalogue : écriture réservée à l’administrateur', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let traiteurId: string;
  const actors = {} as Record<
    'admin' | 'employee' | 'team' | 'driver' | 'client' | 'superAdmin',
    Actor
  >;

  const server = (): App => app.getHttpServer() as App;

  function send(actor: Actor, method: Method, path: string, body?: object) {
    const call = request(server())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${actor.token}`);
    return body ? call.send(body) : call;
  }

  async function memberActor(role: Role): Promise<Actor> {
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
    return { token: issued.accessToken, userId: user.id };
  }

  async function superAdminActor(): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: 'Super',
        lastName: 'Admin',
        isSuperAdmin: true,
      },
    });
    const issued = await tokens.issueTokens(
      user.id,
      true,
      { traiteurId, membershipId: null, role: 'SUPER_ADMIN' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, userId: user.id };
  }

  const suffix = () => randomUUID().slice(0, 6);
  const categoryBody = () => ({
    name: { fr: `Catégorie ${suffix()}` },
    description: null,
    isActive: true,
  });
  const dishBody = () => ({
    name: { fr: `Plat ${suffix()}`, ar: 'طبق' },
    description: null,
    categoryId: null,
    price: 25_000,
    taxRateBps: null,
    unit: 'PER_PERSON',
    minQuantity: 1,
    allergens: [],
    imageKey: null,
    isAvailable: true,
  });
  const packageBody = (dishId: string) => ({
    name: { fr: `Formule ${suffix()}` },
    description: null,
    pricePerPerson: 30_000,
    taxRateBps: null,
    minGuests: 10,
    maxGuests: null,
    imageKey: null,
    isActive: true,
    dishes: [{ dishId, quantity: 1 }],
    rangeId: null,
    eventTypeIds: [],
  });
  const serviceBody = () => ({
    name: { fr: `Service ${suffix()}` },
    description: null,
    price: 50_000,
    taxRateBps: null,
    pricingUnit: 'FLAT',
    isActive: true,
  });

  /** Création par l'administrateur des éléments sur lesquels portent les opérations. */
  async function created(path: string, body: object): Promise<string> {
    const response = await send(actors.admin, 'post', path, body).expect(201);
    return (response.body as { id: string }).id;
  }
  const newDish = async () => ({ id: await created('/catalog/dishes', dishBody()) });
  const newCategory = async () => ({ id: await created('/catalog/categories', categoryBody()) });
  const newService = async () => ({ id: await created('/catalog/services', serviceBody()) });
  const listBody = () => ({
    name: { fr: `Élément ${suffix()}` },
    description: null,
    isActive: true,
  });
  const newEventType = async () => ({
    id: await created('/catalog/lists/event-types', listBody()),
  });
  const newRange = async () => ({ id: await created('/catalog/lists/ranges', listBody()) });
  const newPackage = async () => {
    const dish = await newDish();
    return { id: await created('/catalog/packages', packageBody(dish.id)), dishId: dish.id };
  };

  const OPERATIONS: WriteOperation[] = [
    {
      name: 'créer une catégorie',
      method: 'post',
      path: () => '/catalog/categories',
      body: categoryBody,
    },
    {
      name: 'modifier une catégorie',
      method: 'patch',
      path: (ids) => `/catalog/categories/${ids.id}`,
      body: categoryBody,
      prepare: newCategory,
    },
    {
      name: 'réordonner les catégories',
      method: 'put',
      path: () => '/catalog/categories/order',
      prepare: newCategory,
    },
    { name: 'créer un plat', method: 'post', path: () => '/catalog/dishes', body: dishBody },
    {
      name: 'modifier un plat',
      method: 'put',
      path: (ids) => `/catalog/dishes/${ids.id}`,
      body: dishBody,
      prepare: newDish,
    },
    {
      name: 'archiver un plat',
      method: 'post',
      path: (ids) => `/catalog/dishes/${ids.id}/archive`,
      prepare: newDish,
    },
    {
      name: 'supprimer un plat',
      method: 'delete',
      path: (ids) => `/catalog/dishes/${ids.id}`,
      prepare: newDish,
    },
    {
      name: 'créer une formule',
      method: 'post',
      path: () => '/catalog/packages',
      prepare: newDish,
    },
    {
      name: 'modifier une formule',
      method: 'put',
      path: (ids) => `/catalog/packages/${ids.id}`,
      prepare: newPackage,
    },
    {
      name: 'archiver une formule',
      method: 'post',
      path: (ids) => `/catalog/packages/${ids.id}/archive`,
      prepare: newPackage,
    },
    {
      name: 'supprimer une formule',
      method: 'delete',
      path: (ids) => `/catalog/packages/${ids.id}`,
      prepare: newPackage,
    },
    {
      name: 'créer un service',
      method: 'post',
      path: () => '/catalog/services',
      body: serviceBody,
    },
    {
      name: 'modifier un service',
      method: 'put',
      path: (ids) => `/catalog/services/${ids.id}`,
      body: serviceBody,
      prepare: newService,
    },
    {
      name: 'archiver un service',
      method: 'post',
      path: (ids) => `/catalog/services/${ids.id}/archive`,
      prepare: newService,
    },
    {
      name: 'supprimer un service',
      method: 'delete',
      path: (ids) => `/catalog/services/${ids.id}`,
      prepare: newService,
    },
    {
      name: 'créer un type d’événement',
      method: 'post',
      path: () => '/catalog/lists/event-types',
      body: listBody,
    },
    {
      name: 'modifier un type d’événement',
      method: 'patch',
      path: (ids) => `/catalog/lists/event-types/${ids.id}`,
      body: listBody,
      prepare: newEventType,
    },
    {
      name: 'archiver un type d’événement',
      method: 'post',
      path: (ids) => `/catalog/lists/event-types/${ids.id}/archive`,
      prepare: newEventType,
    },
    {
      name: 'supprimer un type d’événement',
      method: 'delete',
      path: (ids) => `/catalog/lists/event-types/${ids.id}`,
      prepare: newEventType,
    },
    {
      name: 'créer une gamme',
      method: 'post',
      path: () => '/catalog/lists/ranges',
      body: listBody,
    },
    {
      name: 'modifier une gamme',
      method: 'patch',
      path: (ids) => `/catalog/lists/ranges/${ids.id}`,
      body: listBody,
      prepare: newRange,
    },
    {
      name: 'réordonner les gammes',
      method: 'put',
      path: () => '/catalog/lists/ranges/order',
      prepare: newRange,
    },
    {
      name: 'archiver une gamme',
      method: 'post',
      path: (ids) => `/catalog/lists/ranges/${ids.id}/archive`,
      prepare: newRange,
    },
    {
      name: 'supprimer une gamme',
      method: 'delete',
      path: (ids) => `/catalog/lists/ranges/${ids.id}`,
      prepare: newRange,
    },
    {
      name: 'préparer l’envoi d’une photo',
      method: 'post',
      path: () => '/catalog/uploads',
      body: () => ({ contentType: 'image/png', size: 1024 }),
    },
  ];

  /** Corps de requête : fixe, ou dépendant des éléments préparés. */
  function bodyFor(operation: WriteOperation, ids: Record<string, string>): object | undefined {
    const prepared = (key: string): string => {
      const value = ids[key];
      if (!value) throw new Error(`Élément préparé manquant : ${key}`);
      return value;
    };
    if (
      operation.name === 'réordonner les catégories' ||
      operation.name === 'réordonner les gammes'
    ) {
      return { ids: [prepared('id')] };
    }
    if (operation.name === 'créer une formule') return packageBody(prepared('id'));
    if (operation.name === 'modifier une formule') return packageBody(prepared('dishId'));
    return operation.body?.();
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `catalogue-droits-${suffix()}`,
        name: 'Traiteur droits',
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
    traiteurId = traiteur.id;
    actors.admin = await memberActor('ADMIN_TRAITEUR');
    actors.employee = await memberActor('EMPLOYE');
    actors.team = await memberActor('EQUIPE');
    actors.driver = await memberActor('LIVREUR');
    actors.client = await memberActor('CLIENT');
    actors.superAdmin = await superAdminActor();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe.each(['employee', 'team', 'driver', 'client'] as const)('rôle %s', (role) => {
    it.each(OPERATIONS.map((operation) => [operation.name, operation] as const))(
      'refusé : %s',
      async (_name, operation) => {
        const ids = (await operation.prepare?.()) ?? {};
        await send(
          actors[role],
          operation.method,
          operation.path(ids),
          bodyFor(operation, ids),
        ).expect(403);
      },
    );
  });

  describe.each(['admin', 'superAdmin'] as const)('rôle %s', (role) => {
    it.each(OPERATIONS.map((operation) => [operation.name, operation] as const))(
      'autorisé : %s',
      async (_name, operation) => {
        const ids = (await operation.prepare?.()) ?? {};
        const response = await send(
          actors[role],
          operation.method,
          operation.path(ids),
          bodyFor(operation, ids),
        );
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
      },
    );
  });

  it('la lecture reste ouverte à l’employé et au client, pas à l’équipe ni au livreur', async () => {
    await send(actors.employee, 'post', '/catalog/dishes', dishBody()).expect(403);
    await request(server())
      .get('/api/v1/catalog/dishes')
      .set('Authorization', `Bearer ${actors.employee.token}`)
      .expect(200);
    await request(server())
      .get('/api/v1/catalog/dishes')
      .set('Authorization', `Bearer ${actors.client.token}`)
      .expect(200);
    for (const actor of [actors.team, actors.driver]) {
      await request(server())
        .get('/api/v1/catalog/dishes')
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(403);
    }
  });

  it('trace dans l’audit chaque modification du super-admin, avec son rôle', async () => {
    const dishId = await created('/catalog/dishes', dishBody());
    await send(actors.superAdmin, 'put', `/catalog/dishes/${dishId}`, dishBody()).expect(200);
    await send(actors.superAdmin, 'post', `/catalog/dishes/${dishId}/archive`).expect(200);
    const entries = await prisma.auditLog.findMany({
      where: { traiteurId, entityId: dishId, actorUserId: actors.superAdmin.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => [entry.action, entry.actorRole])).toEqual([
      ['catalog.dish.updated', 'SUPER_ADMIN'],
      ['catalog.dish.archived', 'SUPER_ADMIN'],
    ]);
  });

  it('refuse toute dérogation sur catalog.write dans la grille des permissions', async () => {
    const response = await send(actors.admin, 'put', '/settings/permissions', {
      changes: [{ role: 'EMPLOYE', key: 'catalog.write', granted: true }],
    }).expect(400);
    expect((response.body as { code: string }).code).toBe('PERMISSION_NOT_EDITABLE');

    const grid = await request(server())
      .get('/api/v1/settings/permissions')
      .set('Authorization', `Bearer ${actors.admin.token}`)
      .expect(200);
    const row = (
      grid.body as { permissions: { key: string; editable: boolean }[] }
    ).permissions.find((permission) => permission.key === 'catalog.write');
    expect(row?.editable).toBe(false);
  });

  it('ignore puis supprime une ancienne dérogation enregistrée en base', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'catalog.write' },
    });
    await prisma.rolePermission.create({
      data: { traiteurId, role: 'EMPLOYE', permissionId: permission.id, granted: true },
    });
    // Déjà sans effet : la permission est verrouillée
    await send(actors.employee, 'post', '/catalog/dishes', dishBody()).expect(403);

    await syncPermissionCatalog(prisma);
    expect(
      await prisma.rolePermission.count({ where: { traiteurId, permissionId: permission.id } }),
    ).toBe(0);
  });
});
