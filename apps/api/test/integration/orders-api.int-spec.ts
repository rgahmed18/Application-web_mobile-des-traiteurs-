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
 * Clients, commandes, calendrier et tableau de bord par HTTP, avec l'application complète.
 * Chaque traiteur est isolé : aucun ne voit ni ne modifie les données d'un autre.
 */
interface Actor {
  token: string;
  traiteurId: string;
  userId: string;
}

interface OrderBody {
  id: string;
  reference: string;
  status: string;
  version: number;
  totalTtc: number;
  totalHt: number;
  totalTax: number;
  guestCount: number;
  lines: { id: string; perPerson: boolean; quantity: number; totalTtc: number }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('API clients, commandes et calendrier (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;

  async function createTraiteur(maxEventsPerDay: number | null = null): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `commandes-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        maxEventsPerDay,
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role, firstName = 'Test'): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName, lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName, lastName: role },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId, userId: user.id };
  }

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

  const clientBody = (overrides: Record<string, unknown> = {}) => ({
    phone: randomPhone(),
    firstName: 'Nadia',
    lastName: 'Idrissi',
    email: null,
    locale: 'fr',
    tags: ['mariage'],
    internalNotes: null,
    address: null,
    ...overrides,
  });

  async function createClient(actor: Actor, overrides: Record<string, unknown> = {}) {
    const response = await api(actor).post('/clients', clientBody(overrides)).expect(201);
    return response.body as { id: string; firstName: string; phone: string };
  }

  async function createDish(actor: Actor): Promise<string> {
    const response = await api(actor)
      .post('/catalog/dishes', {
        name: { fr: `Pastilla ${randomUUID().slice(0, 6)}` },
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
    return (response.body as { id: string }).id;
  }

  const orderBody = (
    clientId: string,
    dishId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    clientId,
    eventType: 'WEDDING',
    eventDate: '2027-03-20',
    startTime: '19:00',
    endTime: '02:00',
    endsNextDay: true,
    guestCount: 100,
    venueName: 'Salle Les Jasmins',
    venueAddress: '8, avenue Hassan II',
    city: 'Casablanca',
    notes: null,
    internalNotes: null,
    status: 'PENDING',
    lines: [
      {
        itemType: 'DISH',
        dishId,
        label: 'Pastilla',
        quantity: 100,
        unitPrice: 4_500,
        taxRateBps: 2000,
        perPerson: true,
      },
      {
        itemType: 'CUSTOM',
        label: 'Gâteau de mariage',
        quantity: 1,
        unitPrice: 300_000,
        discount: 20_000,
        taxRateBps: 2000,
        perPerson: false,
      },
      {
        itemType: 'CUSTOM',
        label: 'Jus frais',
        quantity: 100,
        unitPrice: 1_500,
        taxRateBps: 1000,
        perPerson: true,
      },
    ],
    ...overrides,
  });

  async function createOrder(actor: Actor, body: object, status = 201): Promise<OrderBody> {
    const response = await api(actor).post('/orders', body).expect(status);
    return response.body as OrderBody;
  }

  /** Corps d'une modification reprenant la commande telle quelle. */
  const updateBody = (
    base: ReturnType<typeof orderBody>,
    order: OrderBody,
    overrides: object = {},
  ) => {
    const { status: _status, ...fields } = base;
    return { ...fields, version: order.version, reason: null, ...overrides };
  };

  const transition = (actor: Actor, order: OrderBody, to: string, extra: object = {}) =>
    api(actor).post(`/orders/${order.id}/transitions`, { to, version: order.version, ...extra });

  let traiteurA: string;
  let adminA: Actor;
  let employeeA: Actor;
  let driverA: Actor;
  let adminB: Actor;
  let dishA: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    traiteurA = await createTraiteur();
    adminA = await actorFor(traiteurA, 'ADMIN_TRAITEUR', 'Karim');
    employeeA = await actorFor(traiteurA, 'EMPLOYE', 'Fatima');
    driverA = await actorFor(traiteurA, 'LIVREUR', 'Youssef');
    adminB = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
    dishA = await createDish(adminA);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ─────────────────────────── Clients ───────────────────────────

  describe('clients', () => {
    it('crée un client sans mot de passe et le retrouve par nom ou par téléphone', async () => {
      const phone = randomPhone();
      const created = await createClient(adminA, {
        phone: `0${phone.slice(4)}`,
        lastName: 'Alaoui',
      });
      expect(created.phone).toBe(phone);
      const account = await prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(account.passwordHash).toBeNull();

      const byPhone = await api(adminA)
        .get(`/clients?search=${phone.slice(5, 11)}`)
        .expect(200);
      expect((byPhone.body as { items: { id: string }[] }).items.map((c) => c.id)).toContain(
        created.id,
      );
      const byName = await api(adminA).get('/clients?search=nadia%20alaoui').expect(200);
      expect((byName.body as { items: { id: string }[] }).items.map((c) => c.id)).toContain(
        created.id,
      );
    });

    it('accepte un numéro étranger', async () => {
      const created = await createClient(adminA, { phone: '+33612345678' });
      expect(created.phone).toBe('+33612345678');
    });

    it('rattache un compte existant sans doublon ni fuite des coordonnées d’un autre traiteur', async () => {
      const phone = randomPhone();
      await createClient(adminA, {
        phone,
        firstName: 'Salma',
        lastName: 'Bennani',
        email: 'salma@a.ma',
      });
      const atB = await api(adminB)
        .post('/clients', clientBody({ phone, firstName: 'S.', lastName: 'B.' }))
        .expect(201);
      // Réponse identique à une création : rien de ce qu'a saisi le traiteur A
      expect(atB.body).toMatchObject({
        firstName: 'S.',
        lastName: 'B.',
        email: null,
        orderCount: 0,
      });
      expect(await prisma.user.count({ where: { phone } })).toBe(1);
      expect(await prisma.membership.count({ where: { user: { phone } } })).toBe(2);
    });

    it('refuse un doublon chez le même traiteur et un numéro du personnel', async () => {
      const phone = randomPhone();
      const first = await createClient(adminA, { phone });
      const again = await api(adminA).post('/clients', clientBody({ phone })).expect(409);
      expect(again.body).toMatchObject({ code: 'CLIENT_EXISTS', clientId: first.id });

      const staff = await prisma.user.findUniqueOrThrow({ where: { id: employeeA.userId } });
      const staffPhone = await api(adminA)
        .post('/clients', clientBody({ phone: staff.phone }))
        .expect(409);
      expect(staffPhone.body).toMatchObject({ code: 'PHONE_IS_STAFF' });
    });

    it('isolation : B ne voit ni ne modifie les clients de A', async () => {
      const client = await createClient(adminA);
      await api(adminB).get(`/clients/${client.id}`).expect(404);
      await api(adminB).put(`/clients/${client.id}`, clientBody()).expect(404);
      const list = await api(adminB).get('/clients?pageSize=100').expect(200);
      expect((list.body as { items: { id: string }[] }).items.map((c) => c.id)).not.toContain(
        client.id,
      );
    });

    it('permissions : l’employé crée un client, le livreur n’y a pas accès', async () => {
      await createClient(employeeA);
      await api(driverA).get('/clients').expect(403);
      await api(driverA).post('/clients', clientBody()).expect(403);
    });

    it('fiche : adresses (une seule par défaut), historique et total dépensé', async () => {
      const client = await createClient(adminA, {
        address: { label: 'Domicile', address: '1, rue des Roses', city: 'Rabat', isDefault: true },
      });
      const updated = await api(adminA)
        .post(`/clients/${client.id}/addresses`, {
          label: 'Salle',
          address: '2, avenue Mohammed V',
          city: 'Rabat',
          isDefault: true,
        })
        .expect(201);
      const addresses = (updated.body as { addresses: { label: string; isDefault: boolean }[] })
        .addresses;
      expect(addresses.filter((item) => item.isDefault).map((item) => item.label)).toEqual([
        'Salle',
      ]);

      const order = await createOrder(
        adminA,
        orderBody(client.id, dishA, { status: 'CONFIRMED', eventDate: '2027-05-02' }),
      );
      const detail = await api(adminA).get(`/clients/${client.id}`).expect(200);
      expect(detail.body).toMatchObject({ orderCount: 1, totalSpent: order.totalTtc });
    });
  });

  // ─────────────────────────── Commandes ───────────────────────────

  describe('commandes', () => {
    it('crée une commande avec 3 lignes : totaux exacts, référence, lignes par personne', async () => {
      const client = await createClient(employeeA);
      const order = await createOrder(employeeA, orderBody(client.id, dishA));
      expect(order.reference).toMatch(/^CMD-2026-\d{5}$/);
      expect(order.status).toBe('PENDING');
      // 100 × 45,00 + (3 000,00 − 200,00) + 100 × 15,00 = 8 800,00 TTC
      expect(order.totalTtc).toBe(880_000);
      expect(order.totalHt + order.totalTax).toBe(order.totalTtc);
      expect(order.lines.map((line) => line.perPerson)).toEqual([true, false, true]);

      const history = await api(employeeA).get(`/orders/${order.id}/history`).expect(200);
      expect(history.body).toEqual([
        expect.objectContaining({
          kind: 'CREATED',
          toStatus: 'PENDING',
          actorName: 'Fatima EMPLOYE',
        }),
      ]);
    });

    it('un compte client ne peut ni créer une commande au back-office, ni changer un statut', async () => {
      const client = await createClient(adminA);
      const order = await createOrder(adminA, orderBody(client.id, dishA));
      const membership = await prisma.membership.findUniqueOrThrow({ where: { id: client.id } });
      const issued = await tokens.issueTokens(
        membership.userId,
        false,
        { traiteurId: traiteurA, membershipId: membership.id, role: 'CLIENT' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      );
      const asClient: Actor = {
        token: issued.accessToken,
        traiteurId: traiteurA,
        userId: membership.userId,
      };
      const created = await api(asClient).post('/orders', orderBody(client.id, dishA)).expect(403);
      expect(created.body).toMatchObject({ code: 'FORBIDDEN_ROLE' });
      await transition(asClient, order, 'CANCELLED', { reason: 'x' }).expect(403);
      await api(asClient).get(`/orders/${order.id}`).expect(403);
    });

    it('la fin d’un événement peut tomber le lendemain, mais doit suivre le début', async () => {
      const client = await createClient(adminA);
      const order = await api(adminA).post('/orders', orderBody(client.id, dishA)).expect(201);
      expect(order.body).toMatchObject({ endTime: '02:00', endsNextDay: true });
      const invalid = await api(adminA)
        .post('/orders', orderBody(client.id, dishA, { endTime: '18:00', endsNextDay: false }))
        .expect(400);
      expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('isolation : B ne lit, ne modifie ni ne fait avancer les commandes de A', async () => {
      const client = await createClient(adminA);
      const order = await createOrder(adminA, orderBody(client.id, dishA));
      await api(adminB).get(`/orders/${order.id}`).expect(404);
      await api(adminB)
        .put(`/orders/${order.id}`, updateBody(orderBody(client.id, dishA), order))
        .expect(404);
      await transition(adminB, order, 'CONFIRMED').expect(404);
      const list = await api(adminB).get('/orders?pageSize=100').expect(200);
      expect((list.body as { items: { id: string }[] }).items).toHaveLength(0);

      // B ne peut pas utiliser un client ou un plat de A
      const clientB = await createClient(adminB);
      await api(adminB).post('/orders', orderBody(client.id, dishA)).expect(404);
      await api(adminB).post('/orders', orderBody(clientB.id, dishA)).expect(404);
    });

    it('machine à états : transitions, permissions, motif, historique et audit', async () => {
      const client = await createClient(adminA);
      let order = await createOrder(
        adminA,
        orderBody(client.id, dishA, { eventDate: '2027-04-10' }),
      );

      const jump = await transition(adminA, order, 'DELIVERED').expect(400);
      expect(jump.body).toMatchObject({ code: 'INVALID_TRANSITION' });

      order = (await transition(employeeA, order, 'CONFIRMED').expect(200)).body as OrderBody;
      expect(order.status).toBe('CONFIRMED');

      // Annulation : interdite à l'employé, motif obligatoire pour l'administrateur
      await transition(employeeA, order, 'CANCELLED', { reason: 'Report' }).expect(403);
      const noReason = await transition(adminA, order, 'CANCELLED').expect(400);
      expect(noReason.body).toMatchObject({ code: 'REASON_REQUIRED' });

      order = (await transition(employeeA, order, 'IN_PREPARATION').expect(200)).body as OrderBody;
      order = (await transition(driverA, order, 'OUT_FOR_DELIVERY').expect(200)).body as OrderBody;
      // Le livreur ne peut pas clôturer
      order = (await transition(driverA, order, 'DELIVERED').expect(200)).body as OrderBody;
      await transition(driverA, order, 'COMPLETED').expect(403);
      order = (await transition(adminA, order, 'COMPLETED').expect(200)).body as OrderBody;
      await transition(adminA, order, 'CANCELLED', { reason: 'Trop tard' }).expect(400);

      const history = (await api(adminA).get(`/orders/${order.id}/history`).expect(200)).body as {
        kind: string;
        toStatus: string;
      }[];
      expect(history.map((entry) => entry.toStatus)).toEqual([
        'COMPLETED',
        'DELIVERED',
        'OUT_FOR_DELIVERY',
        'IN_PREPARATION',
        'CONFIRMED',
        'PENDING',
      ]);
      expect(
        await prisma.auditLog.count({
          where: { entityId: order.id, action: 'order.status_changed' },
        }),
      ).toBe(5);
    });

    it('annulation avec motif : horodatée et motif conservé', async () => {
      const client = await createClient(adminA);
      const order = await createOrder(adminA, orderBody(client.id, dishA));
      const cancelled = await transition(adminA, order, 'CANCELLED', {
        reason: 'Mariage reporté',
      }).expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Mariage reporté',
      });
      expect((cancelled.body as { cancelledAt: string | null }).cancelledAt).not.toBeNull();
    });

    it('verrouillage optimiste : une version périmée est refusée (409) avec l’auteur', async () => {
      const client = await createClient(adminA);
      const base = orderBody(client.id, dishA);
      const order = await createOrder(adminA, base);

      const first = await api(employeeA)
        .put(`/orders/${order.id}`, updateBody(base, order, { notes: 'Table d’honneur' }))
        .expect(200);
      expect((first.body as OrderBody).version).toBeGreaterThan(order.version);

      const stale = await api(adminA)
        .put(`/orders/${order.id}`, updateBody(base, order, { guestCount: 120 }))
        .expect(409);
      expect(stale.body).toMatchObject({
        code: 'ORDER_VERSION_CONFLICT',
        modifiedBy: 'Fatima EMPLOYE',
      });
      expect(String((stale.body as { message: string }).message)).toMatch(
        /^Cette commande a été modifiée par Fatima EMPLOYE à \d{2}:\d{2}$/,
      );
      // Un changement de statut avec l'ancienne version est refusé aussi
      await transition(adminA, order, 'CONFIRMED').expect(409);
    });

    it('verrouillage optimiste : deux modifications simultanées, une seule passe', async () => {
      const client = await createClient(adminA);
      const base = orderBody(client.id, dishA);
      const order = await createOrder(adminA, base);
      const results = await Promise.all([
        api(adminA).put(`/orders/${order.id}`, updateBody(base, order, { guestCount: 110 })),
        api(employeeA).put(`/orders/${order.id}`, updateBody(base, order, { guestCount: 130 })),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    });

    it('les écritures de lignes (DocumentLinesService) incrémentent aussi la version', async () => {
      const client = await createClient(adminA);
      const base = orderBody(client.id, dishA);
      const order = await createOrder(adminA, base);
      const lines = base.lines.slice(0, 2);
      const updated = (
        await api(adminA)
          .put(`/orders/${order.id}`, updateBody(base, order, { lines }))
          .expect(200)
      ).body as OrderBody;
      expect(updated.lines).toHaveLength(2);
      expect(updated.version).toBeGreaterThan(order.version);
      await api(adminA)
        .put(`/orders/${order.id}`, updateBody(base, order, { notes: 'x' }))
        .expect(409);
    });

    it('commande confirmée : notes libres, le reste avec motif et permission, client verrouillé', async () => {
      const client = await createClient(adminA);
      const base = orderBody(client.id, dishA, { eventDate: '2027-04-17' });
      let order = await createOrder(adminA, { ...base, status: 'CONFIRMED' });

      order = (
        await api(employeeA)
          .put(
            `/orders/${order.id}`,
            updateBody(base, order, { notes: 'Accès livraison par la cour' }),
          )
          .expect(200)
      ).body as OrderBody;

      await api(employeeA)
        .put(`/orders/${order.id}`, updateBody(base, order, { guestCount: 150 }))
        .expect(403);
      const noReason = await api(adminA)
        .put(
          `/orders/${order.id}`,
          updateBody(base, order, { guestCount: 150, notes: 'Accès livraison par la cour' }),
        )
        .expect(400);
      expect(noReason.body).toMatchObject({ code: 'REASON_REQUIRED' });

      order = (
        await api(adminA)
          .put(
            `/orders/${order.id}`,
            updateBody(base, order, {
              guestCount: 150,
              notes: 'Accès livraison par la cour',
              reason: '50 invités de plus',
            }),
          )
          .expect(200)
      ).body as OrderBody;
      expect(order.guestCount).toBe(150);

      const otherClient = await createClient(adminA);
      const locked = await api(adminA)
        .put(
          `/orders/${order.id}`,
          updateBody(base, order, {
            clientId: otherClient.id,
            guestCount: 150,
            notes: 'Accès livraison par la cour',
            reason: 'x',
          }),
        )
        .expect(400);
      expect(locked.body).toMatchObject({ code: 'ORDER_LOCKED', field: 'client' });

      const history = (await api(adminA).get(`/orders/${order.id}/history`).expect(200)).body as {
        kind: string;
        reason: string | null;
        changes: string[];
      }[];
      expect(history[0]).toMatchObject({
        kind: 'UPDATED',
        reason: '50 invités de plus',
        changes: ['guests'],
      });
    });
  });

  // ─────────────────────────── Disponibilité ───────────────────────────

  describe('disponibilité', () => {
    let traiteurC: string;
    let adminC: Actor;
    let dishC: string;
    let clientC: string;

    beforeAll(async () => {
      traiteurC = await createTraiteur(1);
      adminC = await actorFor(traiteurC, 'ADMIN_TRAITEUR');
      dishC = await createDish(adminC);
      clientC = (await createClient(adminC)).id;
    });

    it('capacité atteinte : avertissement (409), le traiteur peut forcer et c’est tracé', async () => {
      await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-06-05', status: 'CONFIRMED' }),
      );
      const conflict = await api(adminC)
        .post(
          '/orders',
          orderBody(clientC, dishC, { eventDate: '2027-06-05', status: 'CONFIRMED' }),
        )
        .expect(409);
      expect(conflict.body).toMatchObject({
        code: 'AVAILABILITY_CONFLICT',
        availability: { capacity: 1, firmCount: 1, full: true, blocked: false },
      });

      const forced = await createOrder(
        adminC,
        orderBody(clientC, dishC, {
          eventDate: '2027-06-05',
          status: 'CONFIRMED',
          forceAvailability: true,
        }),
      );
      expect(
        await prisma.auditLog.count({
          where: { entityId: forced.id, action: 'order.availability_overridden' },
        }),
      ).toBe(1);
      const history = (await api(adminC).get(`/orders/${forced.id}/history`)).body as {
        changes: string[];
      }[];
      expect(history[0]?.changes).toEqual(['availabilityForced']);
    });

    it('une commande en attente ne consomme pas de capacité ; sa confirmation est contrôlée', async () => {
      const pending = await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-06-12' }),
      );
      const other = await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-06-12' }),
      );
      await transition(adminC, pending, 'CONFIRMED').expect(200);
      const conflict = await transition(adminC, other, 'CONFIRMED').expect(409);
      expect(conflict.body).toMatchObject({ code: 'AVAILABILITY_CONFLICT' });
      await transition(adminC, other, 'CONFIRMED', { forceAvailability: true }).expect(200);
    });

    it('date bloquée : avertissement à la création, au changement de date et dans le calendrier', async () => {
      await api(adminC)
        .post('/calendar/blocked-dates', { date: '2027-07-01', reason: 'Aïd' })
        .expect(204);
      const conflict = await api(adminC)
        .post('/orders', orderBody(clientC, dishC, { eventDate: '2027-07-01' }))
        .expect(409);
      expect(conflict.body).toMatchObject({
        availability: { blocked: true, blockedReason: 'Aïd' },
      });

      const base = orderBody(clientC, dishC, { eventDate: '2027-07-02' });
      const order = await createOrder(adminC, base);
      await api(adminC)
        .put(`/orders/${order.id}`, updateBody(base, order, { eventDate: '2027-07-01' }))
        .expect(409);

      const calendar = await api(adminC).get('/calendar?from=2027-07-01&to=2027-07-02').expect(200);
      expect(calendar.body).toMatchObject({
        capacity: 1,
        days: [
          { date: '2027-07-01', blocked: true, blockedReason: 'Aïd', firmCount: 0 },
          { date: '2027-07-02', blocked: false, pendingCount: 1 },
        ],
      });
      await api(adminC).delete('/calendar/blocked-dates/2027-07-01').expect(204);
      await api(adminC)
        .post('/orders', orderBody(clientC, dishC, { eventDate: '2027-07-01' }))
        .expect(201);
    });

    it('un événement après minuit ne compte que le jour de son début', async () => {
      // Soirée du 19 au 20 : n'occupe que le 19
      await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-08-19', status: 'CONFIRMED' }),
      );
      const day20 = await api(adminC).get('/orders/availability?date=2027-08-20').expect(200);
      expect(day20.body).toMatchObject({ firmCount: 0, full: false });
      const day19 = await api(adminC).get('/orders/availability?date=2027-08-19').expect(200);
      expect(day19.body).toMatchObject({ firmCount: 1, full: true });
    });

    it('deux confirmations simultanées sur la dernière place : une seule passe', async () => {
      const first = await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-09-09' }),
      );
      const second = await createOrder(
        adminC,
        orderBody(clientC, dishC, { eventDate: '2027-09-09' }),
      );
      const results = await Promise.all([
        transition(adminC, first, 'CONFIRMED'),
        transition(adminC, second, 'CONFIRMED'),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    });

    it('la capacité et les dates bloquées exigent calendar.manage', async () => {
      const employeeC = await actorFor(traiteurC, 'EMPLOYE');
      await api(employeeC).put('/calendar/capacity', { maxEventsPerDay: 5 }).expect(403);
      await api(employeeC)
        .post('/calendar/blocked-dates', { date: '2027-10-01', reason: null })
        .expect(403);
      await api(adminC).put('/calendar/capacity', { maxEventsPerDay: 1 }).expect(204);
    });
  });

  // ─────────────────────────── Tableau de bord ───────────────────────────

  describe('tableau de bord', () => {
    it('commandes du jour, à venir, en attente, à clôturer et CA des événements du mois', async () => {
      const traiteurD = await createTraiteur();
      const adminD = await actorFor(traiteurD, 'ADMIN_TRAITEUR');
      const dishD = await createDish(adminD);
      const clientD = (await createClient(adminD)).id;
      const now = new Date();
      const day = (offset: number) => {
        const date = new Date(now.getTime() + offset * 86_400_000);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(date);
      };
      const at = (offset: number, overrides: object = {}) =>
        orderBody(clientD, dishD, {
          eventDate: day(offset),
          startTime: '12:00',
          endTime: '15:00',
          endsNextDay: false,
          ...overrides,
        });

      const confirmedToday = await createOrder(adminD, at(0, { status: 'CONFIRMED' }));
      await createOrder(adminD, at(3));
      await createOrder(adminD, at(-2, { status: 'CONFIRMED' }));
      const cancelled = await createOrder(adminD, at(2));
      await transition(adminD, cancelled, 'CANCELLED', { reason: 'Annulé' }).expect(200);

      const dashboard = await api(adminD).get('/dashboard').expect(200);
      expect(dashboard.body).toMatchObject({
        today: day(0),
        next7DaysCount: 1,
        awaitingCount: 1,
        toCloseCount: 1,
      });
      expect(
        (dashboard.body as { todayOrders: { id: string }[] }).todayOrders.map((o) => o.id),
      ).toEqual([confirmedToday.id]);
      const toClose = await api(adminD).get('/orders?toClose=true').expect(200);
      expect((toClose.body as { total: number }).total).toBe(1);
      await api(driverA).get('/dashboard').expect(403);
    });
  });
});
