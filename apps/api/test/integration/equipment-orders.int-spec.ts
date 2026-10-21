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
 * Matériel et buffets dans les commandes et les devis : lignes rattachées au catalogue, délais
 * du matériel par commande, stock vérifié quand la commande devient ferme (motif tracé pour
 * passer outre), accord en ligne d'un devis en manque de matériel laissé au traiteur.
 */
interface Actor {
  token: string;
  traiteurId: string;
}

interface OrderBody {
  id: string;
  status: string;
  version: number;
  equipmentSetupHours: number | null;
  equipmentReturnHours: number | null;
  lines: {
    itemType: string;
    equipmentId: string | null;
    buffetId: string | null;
    quantity: number;
  }[];
}

interface Shortage {
  equipmentId: string;
  requested: number;
  stock: number;
  reserved: number;
  pending: number;
  remaining: number;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Matériel et buffets dans les commandes (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let clientId: string;
  let chairs: string;
  let buffet: string;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
    };
  };

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Karim', lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName: 'Karim', lastName: role },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId };
  }

  const chairLine = (quantity: number) => ({
    itemType: 'EQUIPMENT',
    equipmentId: chairs,
    label: { fr: 'Chaise Napoléon', ar: 'كرسي نابليون' },
    quantity,
    unitPrice: 1_500,
    taxRateBps: 2000,
    perPerson: false,
  });

  const orderBody = (
    date: string,
    status: string,
    lines: object[],
    extra: Record<string, unknown> = {},
  ) => ({
    clientId,
    eventType: 'WEDDING',
    eventDate: date,
    startTime: '20:00',
    endTime: '23:30',
    endsNextDay: false,
    guestCount: 100,
    venueName: null,
    venueAddress: '8, avenue Hassan II',
    city: 'Casablanca',
    notes: null,
    internalNotes: null,
    status,
    forceAvailability: true,
    lines,
    ...extra,
  });

  const createOrder = async (body: object) =>
    (await api(admin).post('/orders', body).expect(201)).body as OrderBody;

  const stockAudits = (orderId: string) =>
    prisma.auditLog.findMany({
      where: { entityType: 'Order', entityId: orderId, action: 'equipment.stock_overridden' },
    });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `materiel-commandes-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        isVatRegistered: true,
        defaultTaxRateBps: 2000,
      },
    });
    await prisma.featureFlag.create({
      data: { traiteurId: traiteur.id, key: 'quotes', enabled: true },
    });
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    clientId = (
      (
        await api(admin)
          .post('/clients', {
            phone: randomPhone(),
            firstName: 'Salma',
            lastName: 'Bennani',
            email: null,
            locale: 'fr',
            tags: [],
            internalNotes: null,
            address: null,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    chairs = (
      (
        await api(admin)
          .post('/catalog/equipment', {
            name: { fr: 'Chaise Napoléon', ar: 'كرسي نابليون' },
            description: null,
            categoryId: null,
            rangeId: null,
            price: 1_500,
            replacementPrice: 45_000,
            taxRateBps: null,
            stockQuantity: 100,
            imageKey: null,
            isActive: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    buffet = (
      (
        await api(admin)
          .post('/catalog/buffets', {
            name: { fr: 'Buffet thé', ar: 'بوفيه الشاي' },
            description: null,
            typeId: null,
            rangeId: null,
            pricingUnit: 'PER_PERSON',
            price: 6_000,
            taxRateBps: null,
            minGuests: 20,
            imageKey: null,
            isActive: true,
            dishes: [],
            freeItems: [{ fr: 'Thé à la menthe', ar: 'أتاي' }],
          })
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lignes de matériel et de buffet, délais propres à la commande, recopiées dans le devis', async () => {
    const order = await createOrder(
      orderBody(
        '2027-09-04',
        'PENDING',
        [
          chairLine(40),
          {
            itemType: 'BUFFET',
            buffetId: buffet,
            label: { fr: 'Buffet thé', ar: 'بوفيه الشاي' },
            quantity: 100,
            unitPrice: 6_000,
            taxRateBps: 2000,
            perPerson: true,
          },
        ],
        { equipmentSetupHours: 4, equipmentReturnHours: null },
      ),
    );
    expect(order).toMatchObject({ equipmentSetupHours: 4, equipmentReturnHours: null });
    expect(order.lines.map((line) => [line.itemType, line.equipmentId, line.buffetId])).toEqual([
      ['EQUIPMENT', chairs, null],
      ['BUFFET', null, buffet],
    ]);

    // Type et référence incohérents : refusé ; article d'un autre traiteur : introuvable
    await api(admin)
      .post(
        '/orders',
        orderBody('2027-09-04', 'PENDING', [
          { ...chairLine(1), equipmentId: null, buffetId: buffet },
        ]),
      )
      .expect(400);
    await api(admin)
      .post(
        '/orders',
        orderBody('2027-09-04', 'PENDING', [{ ...chairLine(1), equipmentId: randomUUID() }]),
      )
      .expect(404);

    // Le devis recopie les références au catalogue ; matériel et buffet deviennent « utilisés »
    const quote = (await api(admin).post(`/orders/${order.id}/quotes`, {}).expect(201)).body as {
      id: string;
    };
    const quoteLines = await prisma.quoteLine.findMany({
      where: { quoteId: quote.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(quoteLines.map((line) => [line.itemType, line.equipmentId, line.buffetId])).toEqual([
      ['EQUIPMENT', chairs, null],
      ['BUFFET', null, buffet],
    ]);
    expect(
      ((await api(admin).get(`/catalog/buffets/${buffet}`).expect(200)).body as { inUse: boolean })
        .inUse,
    ).toBe(true);
  });

  it('stock dépassé à la confirmation : 409 avec le détail, puis confirmation motivée et tracée', async () => {
    // 80 chaises fermes le samedi soir
    await createOrder(orderBody('2027-10-02', 'CONFIRMED', [chairLine(80)]));
    // 30 de plus le même soir, en attente : acceptée (jamais déduite tant qu'elle attend)
    const pending = await createOrder(orderBody('2027-10-02', 'PENDING', [chairLine(30)]));

    const refused = await api(admin)
      .post(`/orders/${pending.id}/transitions`, {
        to: 'CONFIRMED',
        version: pending.version,
        forceAvailability: true,
      })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'EQUIPMENT_STOCK_CONFLICT' });
    const [shortage] = (refused.body as { shortages: Shortage[] }).shortages;
    expect(shortage).toMatchObject({
      equipmentId: chairs,
      requested: 30,
      stock: 100,
      reserved: 80,
      remaining: 20,
    });
    expect((await api(admin).get(`/orders/${pending.id}`).expect(200)).body).toMatchObject({
      status: 'PENDING',
    });

    // Motif : la commande est confirmée et la dérogation tracée
    await api(admin)
      .post(`/orders/${pending.id}/transitions`, {
        to: 'CONFIRMED',
        version: pending.version,
        forceAvailability: true,
        stockOverrideReason: 'Sous-location de 10 chaises chez Dar Lamia',
      })
      .expect(200);
    const [audit] = await stockAudits(pending.id);
    expect(audit?.after).toMatchObject({
      reason: 'Sous-location de 10 chaises chez Dar Lamia',
      context: 'PENDING→CONFIRMED',
      shortages: [expect.objectContaining({ requested: 30, remaining: 20 })],
    });
  });

  it('création confirmée et modification d’une commande ferme : même contrôle', async () => {
    // 90 chaises fermes ; une autre commande confirmée d'emblée avec 20 : refusée sans motif
    await createOrder(orderBody('2027-11-06', 'CONFIRMED', [chairLine(90)]));
    const body = orderBody('2027-11-06', 'CONFIRMED', [chairLine(20)]);
    expect((await api(admin).post('/orders', body).expect(409)).body).toMatchObject({
      code: 'EQUIPMENT_STOCK_CONFLICT',
    });

    // Une commande ferme qui reste dans le stock, puis augmentée au-delà
    const order = await createOrder(orderBody('2027-11-06', 'CONFIRMED', [chairLine(10)]));
    const update = {
      ...orderBody('2027-11-06', 'CONFIRMED', [chairLine(25)]),
      version: order.version,
      reason: 'Invités supplémentaires',
    };
    expect((await api(admin).put(`/orders/${order.id}`, update).expect(409)).body).toMatchObject({
      code: 'EQUIPMENT_STOCK_CONFLICT',
    });
    await api(admin)
      .put(`/orders/${order.id}`, { ...update, stockOverrideReason: 'Chaises du client' })
      .expect(200);
    expect(await stockAudits(order.id)).toHaveLength(1);
  });

  it('accord en ligne d’un devis alors que le matériel manque : commande laissée au traiteur', async () => {
    await createOrder(orderBody('2027-12-04', 'CONFIRMED', [chairLine(100)]));
    const order = await createOrder(orderBody('2027-12-04', 'PENDING', [chairLine(5)]));
    const draft = (await api(admin).post(`/orders/${order.id}/quotes`, {}).expect(201)).body as {
      id: string;
    };
    const sent = (await api(admin).post(`/quotes/${draft.id}/send`).expect(200)).body as {
      link: { url: string };
    };
    const token = sent.link.url.split('/devis/')[1] ?? '';
    const accepted = (
      await request(server())
        .post(`/api/v1/public/quotes/${token}/accept`)
        .send({ name: 'Salma Bennani', consent: true })
        .expect(200)
    ).body as { status: string; availabilityPending: boolean };
    expect(accepted).toMatchObject({ status: 'ACCEPTED', availabilityPending: true });
    expect((await api(admin).get(`/orders/${order.id}`).expect(200)).body).toMatchObject({
      status: 'QUOTED',
    });
  });

  it('ancien champ libre « Matériel » : n’existe plus dans les informations de service', async () => {
    const order = await createOrder(orderBody('2028-01-08', 'CONFIRMED', [chairLine(1)]));
    await api(admin)
      .put(`/orders/${order.id}/service-info`, {
        onSiteContactName: null,
        onSiteContactPhone: null,
        serviceNotes: 'Entrée de service',
        equipment: '20 tables rondes',
      })
      .expect(200);
    const staffing = (await api(admin).get(`/orders/${order.id}/staffing`).expect(200)).body as {
      serviceInfo: Record<string, unknown>;
    };
    expect(staffing.serviceInfo).toEqual({
      onSiteContactName: null,
      onSiteContactPhone: null,
      serviceNotes: 'Entrée de service',
    });
  });
});
