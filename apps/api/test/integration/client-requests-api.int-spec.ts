import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { addDays, todayInTimeZone } from '@traiteur/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Demandes en ligne des clients : disponibilité sans chiffres, commande « En attente » dont les
 * lignes et les prix viennent du catalogue publié, limites anti-abus, annulation, isolation.
 */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const inDays = (days: number) => addDays(todayInTimeZone('Africa/Casablanca'), days);

describe('Demandes en ligne des clients (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let otherAdmin: Actor;
  let menuId: string;
  let buffetId: string;
  let chairsId: string;
  let serviceId: string;
  let foreignMenuId: string;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`),
    // Adresse différente à chaque appel : la limitation de débit par IP n'est pas l'objet ici
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .set(
          'X-Forwarded-For',
          `41.253.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
        )
        .send(body),
  });

  async function createTraiteur() {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `demande-${suffix}`,
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

  async function actorFor(
    traiteurId: string,
    role: Role,
    clientApproval: 'APPROVED' | 'PENDING' = 'APPROVED',
  ): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Test', lastName: role },
    });
    const membership = await prisma.membership.create({
      data: {
        traiteurId,
        userId: user.id,
        role,
        firstName: 'Salma',
        lastName: role,
        clientApproval,
      },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId, membershipId: membership.id };
  }

  const listId = async (actor: Actor, list: string, code: string) =>
    (
      (await api(actor).get(`/catalog/lists/${list}`).expect(200)).body as {
        id: string;
        code: string;
      }[]
    ).find((item) => item.code === code)?.id ?? '';

  async function createMenu(actor: Actor, name: string): Promise<string> {
    const dish = await api(actor)
      .post('/catalog/dishes', {
        name: { fr: 'Pastilla' },
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
      .expect(201);
    const response = await api(actor)
      .post('/catalog/packages', {
        name: { fr: name, ar: 'قائمة' },
        description: null,
        pricePerPerson: 30_000,
        taxRateBps: null,
        minGuests: 10,
        maxGuests: 200,
        imageKey: null,
        isActive: true,
        dishes: [{ dishId: (dish.body as { id: string }).id, quantity: 1 }],
        rangeId: null,
        eventTypeIds: [],
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  const requestBody = (overrides: Record<string, unknown> = {}) => ({
    eventType: 'WEDDING',
    eventDate: inDays(30),
    startTime: '19:00',
    endTime: '02:00',
    endsNextDay: true,
    guestCount: 120,
    venueName: 'Salle Al Andalous',
    venueAddress: '12 avenue Hassan II',
    city: 'Rabat',
    saveAddressAs: null,
    onSiteContactName: null,
    onSiteContactPhone: null,
    notes: 'Menu sans gluten pour 3 invités',
    items: [
      { kind: 'menu', id: menuId, quantity: 1 },
      { kind: 'equipment', id: chairsId, quantity: 40 },
      { kind: 'service', id: serviceId, quantity: 1 },
    ],
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

    const traiteur = await createTraiteur();
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    otherAdmin = await actorFor((await createTraiteur()).id, 'ADMIN_TRAITEUR');

    menuId = await createMenu(admin, 'Menu Prestige');
    foreignMenuId = await createMenu(otherAdmin, 'Menu d’ailleurs');
    buffetId = (
      (
        await api(admin)
          .post('/catalog/buffets', {
            name: { fr: 'Buffet thé' },
            description: null,
            typeId: await listId(admin, 'buffet-types', 'TEA'),
            rangeId: null,
            pricingUnit: 'FLAT',
            price: 250_000,
            taxRateBps: null,
            minGuests: 1,
            imageKey: null,
            isActive: true,
            dishes: [],
            freeItems: [{ fr: 'Thé à la menthe' }],
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    chairsId = (
      (
        await api(admin)
          .post('/catalog/equipment', {
            name: { fr: 'Chaise Napoléon' },
            description: null,
            categoryId: await listId(admin, 'equipment-categories', 'CHAIRS'),
            rangeId: null,
            price: 1_500,
            replacementPrice: 45_000,
            taxRateBps: null,
            stockQuantity: 50,
            imageKey: null,
            isActive: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    serviceId = (
      (
        await api(admin)
          .post('/catalog/services', {
            name: { fr: 'Serveurs' },
            description: null,
            price: 2_000,
            taxRateBps: null,
            pricingUnit: 'PER_PERSON',
            isActive: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('disponibilité : « disponible » ou « sur demande », sans aucun chiffre', async () => {
    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    const query = (overrides: Record<string, unknown>) => ({
      eventDate: inDays(40),
      startTime: '19:00',
      endTime: null,
      endsNextDay: false,
      equipment: [{ id: chairsId, quantity: 30 }],
      ...overrides,
    });
    const free = await api(customer).post('/client/availability', query({})).expect(200);
    expect(free.body).toEqual({
      date: 'AVAILABLE',
      equipment: [{ id: chairsId, status: 'AVAILABLE' }],
    });
    const short = await api(customer)
      .post('/client/availability', query({ equipment: [{ id: chairsId, quantity: 60 }] }))
      .expect(200);
    expect(short.body).toEqual({
      date: 'AVAILABLE',
      equipment: [{ id: chairsId, status: 'ON_REQUEST' }],
    });
    await prisma.blockedDate.create({
      data: { traiteurId: admin.traiteurId, date: new Date(`${inDays(41)}T00:00:00Z`) },
    });
    const blocked = await api(customer)
      .post('/client/availability', query({ eventDate: inDays(41) }))
      .expect(200);
    expect((blocked.body as { date: string }).date).toBe('ON_REQUEST');
    // Réservé aux clients
    await api(admin).post('/client/availability', query({})).expect(403);
  });

  it('demande : commande « En attente » en ligne, prix du catalogue, prix envoyés ignorés', async () => {
    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    const body = requestBody({ saveAddressAs: 'Salle des fêtes' });
    const tampered = {
      ...body,
      clientId: otherAdmin.membershipId,
      status: 'CONFIRMED',
      items: body.items.map((item) => ({ ...item, unitPrice: 1 })),
    };
    const created = await api(customer).post('/client/requests', tampered).expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: (created.body as { id: string }).id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(order).toMatchObject({
      traiteurId: admin.traiteurId,
      clientId: customer.membershipId,
      status: 'PENDING',
      source: 'ONLINE',
      guestCount: 120,
      notes: 'Menu sans gluten pour 3 invités',
    });
    expect(
      order.items.map((line) => [line.itemType, line.quantity, line.perPerson, line.unitPriceTtc]),
    ).toEqual([
      ['PACKAGE', 120, true, 30_000],
      ['EQUIPMENT', 40, false, 1_500],
      ['EXTRA_SERVICE', 120, true, 2_000],
    ]);
    expect(order.totalTtc).toBe(120 * 30_000 + 40 * 1_500 + 120 * 2_000);
    expect(
      await prisma.clientAddress.count({
        where: { membershipId: customer.membershipId, label: 'Salle des fêtes' },
      }),
    ).toBe(1);
    const history = await prisma.orderStatusChange.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(history).toMatchObject({ toStatus: 'PENDING', actorName: 'Salma CLIENT' });
    // Visible du traiteur comme demande en ligne
    const list = await api(admin).get('/orders?source=ONLINE').expect(200);
    expect((list.body as { items: { id: string; source: string }[] }).items).toEqual([
      expect.objectContaining({ id: order.id, source: 'ONLINE' }),
    ]);
  });

  it('refus : compte non validé, élément d’un autre traiteur ou archivé, invités, date trop proche', async () => {
    const pending = await actorFor(admin.traiteurId, 'CLIENT', 'PENDING');
    const notApproved = await api(pending).post('/client/requests', requestBody());
    expect(notApproved.status).toBe(403);
    expect((notApproved.body as { code: string }).code).toBe('CLIENT_NOT_APPROVED');

    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    const codeOf = async (body: object) =>
      ((await api(customer).post('/client/requests', body)).body as { code: string }).code;
    expect(
      await codeOf(requestBody({ items: [{ kind: 'menu', id: foreignMenuId, quantity: 1 }] })),
    ).toBe('ITEM_UNAVAILABLE');
    expect(await codeOf(requestBody({ guestCount: 5 }))).toBe('GUESTS_OUT_OF_RANGE');
    expect(await codeOf(requestBody({ eventDate: inDays(0) }))).toBe('DATE_TOO_SOON');
    await api(admin).post(`/catalog/buffets/${buffetId}/archive`).expect(200);
    expect(
      await codeOf(requestBody({ items: [{ kind: 'buffet', id: buffetId, quantity: 1 }] })),
    ).toBe('ITEM_UNAVAILABLE');
    expect(await prisma.order.count({ where: { clientId: customer.membershipId } })).toBe(0);
    // Le personnel passe par le back-office
    await api(admin).post('/client/requests', requestBody()).expect(403);
  });

  it('limites : 3 demandes par client sur 24 h', async () => {
    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    for (let i = 0; i < 3; i += 1) {
      await api(customer)
        .post('/client/requests', requestBody({ eventDate: inDays(50 + i) }))
        .expect(201);
    }
    const fourth = await api(customer).post(
      '/client/requests',
      requestBody({ eventDate: inDays(60) }),
    );
    expect(fourth.status).toBe(429);
    expect((fourth.body as { code: string }).code).toBe('REQUEST_LIMIT');
  });

  it('annulation : sa demande en attente seulement ; jamais celle d’un autre client', async () => {
    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    const other = await actorFor(admin.traiteurId, 'CLIENT');
    const id = (
      (
        await api(customer)
          .post('/client/requests', requestBody({ eventDate: inDays(70) }))
          .expect(201)
      ).body as { id: string }
    ).id;
    await api(other).post(`/client/requests/${id}/cancel`).expect(404);
    await api(customer).post(`/client/requests/${id}/cancel`).expect(204);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Annulée par le client',
    });
    const again = await api(customer).post(`/client/requests/${id}/cancel`);
    expect((again.body as { code: string }).code).toBe('ORDER_NOT_CANCELLABLE');
  });
});
