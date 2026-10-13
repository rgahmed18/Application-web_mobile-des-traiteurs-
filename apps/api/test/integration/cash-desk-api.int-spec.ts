import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Encaissement à la livraison par HTTP : montant réglé sur l'affectation, déclaré par le livreur
 * (en attente de remise, non compté), puis remis (compté, avec reçu) ou refusé par l'administrateur.
 */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}

interface Declaration {
  paymentId: string;
  amount: number;
  status: string;
  rejectReason: string | null;
  hasPhoto: boolean;
}

interface MissionBody {
  id: string;
  cashCollection: {
    amount: number;
    method: string;
    declaration: Declaration | null;
    canDeclare: boolean;
  } | null;
}

interface Staffing {
  assignments: {
    id: string;
    staffRole: string;
    cashToCollect: number | null;
    cashMethod: string | null;
    cashDeclaration: Declaration | null;
  }[];
}

interface Payments {
  received: number;
  payments: {
    id: string;
    receiptNumber: string | null;
    pendingRemittance: boolean;
    collectedBy: string | null;
    remittedOn: string | null;
  }[];
}

interface Desk {
  total: number;
  drivers: {
    membershipId: string;
    total: number;
    cheques: number;
    items: { paymentId: string }[];
  }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('API de la caisse livreurs (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let driver: Actor;
  let otherDriver: Actor;
  let cook: Actor;
  let otherAdmin: Actor;
  let clientId: string;

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `caisse-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
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
    return { token: issued.accessToken, traiteurId, membershipId: membership.id };
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
      collect: (missionId: string, fields: Record<string, string>, photo?: Buffer) => {
        let test = auth(request(server()).post(`/api/v1/me/missions/${missionId}/collect`));
        for (const [key, value] of Object.entries(fields)) test = test.field(key, value);
        return photo ? test.attach('photo', photo, 'cheque.png') : test;
      },
    };
  };

  /** Commande du jour (1 000 MAD TTC) : la mission du jour peut être encaissée. */
  async function createOrder() {
    const response = await api(admin)
      .post('/orders', {
        clientId,
        eventType: 'BIRTHDAY',
        eventDate: casablancaDay(0),
        startTime: '23:00',
        endTime: null,
        endsNextDay: false,
        guestCount: 10,
        venueName: null,
        venueAddress: '12, rue des Orangers',
        city: 'Casablanca',
        notes: null,
        internalNotes: null,
        status: 'CONFIRMED',
        forceAvailability: true,
        lines: [
          {
            itemType: 'CUSTOM',
            label: { fr: 'Buffet', ar: 'بوفيه' },
            quantity: 10,
            unitPrice: 10_000,
            taxRateBps: 0,
            perPerson: true,
          },
        ],
      })
      .expect(201);
    return response.body as { id: string; reference: string; totalTtc: number };
  }

  const today = casablancaDay(0);
  const assignDriver = async (
    orderId: string,
    member: Actor,
    cash: { cashToCollect: number | null; cashMethod: string | null },
  ) => {
    const staffing = (
      await api(admin)
        .post(`/orders/${orderId}/assignments`, {
          membershipId: member.membershipId,
          staffRole: 'DRIVER',
          startsAt: `${today}T00:00`,
          endsAt: `${today}T23:59`,
          notes: null,
          force: true,
          ...cash,
        })
        .expect(201)
    ).body as Staffing;
    const assignment = staffing.assignments.find((item) => item.staffRole === 'DRIVER');
    if (!assignment) throw new Error('Affectation manquante');
    return assignment;
  };

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
    driver = await actorFor(traiteurId, 'LIVREUR', 'Youssef');
    otherDriver = await actorFor(traiteurId, 'LIVREUR', 'Hamid');
    cook = await actorFor(traiteurId, 'EQUIPE', 'Fatima');
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
    const client = await api(admin)
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
      .expect(201);
    clientId = (client.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('montant réglé sur l’affectation du chauffeur, visible sur sa seule mission', async () => {
    const order = await createOrder();
    const notDriver = await api(admin)
      .post(`/orders/${order.id}/assignments`, {
        membershipId: cook.membershipId,
        staffRole: 'COOK',
        startsAt: `${today}T00:00`,
        endsAt: `${today}T23:59`,
        notes: null,
        force: true,
        cashToCollect: 50_000,
        cashMethod: 'CASH',
      })
      .expect(400);
    expect(notDriver.body).toMatchObject({ code: 'CASH_NOT_ALLOWED' });
    await api(admin)
      .post(`/orders/${order.id}/assignments`, {
        membershipId: cook.membershipId,
        staffRole: 'COOK',
        startsAt: `${today}T00:00`,
        endsAt: `${today}T23:59`,
        notes: null,
        force: true,
      })
      .expect(201);
    // Montant sans mode : refusé
    await api(admin)
      .post(`/orders/${order.id}/assignments`, {
        membershipId: driver.membershipId,
        staffRole: 'DRIVER',
        startsAt: `${today}T00:00`,
        endsAt: `${today}T23:59`,
        force: true,
        cashToCollect: 50_000,
      })
      .expect(400);
    const assignment = await assignDriver(order.id, driver, {
      cashToCollect: 70_000,
      cashMethod: 'CASH',
    });
    expect(assignment).toMatchObject({ cashToCollect: 70_000, cashMethod: 'CASH' });

    const mission = (await api(driver).get(`/me/missions/${assignment.id}`).expect(200))
      .body as MissionBody;
    expect(mission.cashCollection).toEqual({
      amount: 70_000,
      method: 'CASH',
      declaration: null,
      canDeclare: true,
    });
    // L'équipe ne voit aucun montant sur sa mission
    const cookMissions = (await api(cook).get('/me/missions').expect(200)).body as { id: string }[];
    const cookMission = (await api(cook).get(`/me/missions/${cookMissions[0]?.id}`).expect(200))
      .body as MissionBody;
    expect(cookMission.cashCollection).toBeNull();
    // Un autre livreur ne peut pas déclarer sur cette mission (elle n'existe pas pour lui)
    await api(otherDriver).collect(assignment.id, { amount: '70000', method: 'CASH' }).expect(404);
  });

  it('déclaration (chèque + photo) en attente : non comptée ; remise : comptée avec reçu', async () => {
    const order = await createOrder();
    const assignment = await assignDriver(order.id, driver, {
      cashToCollect: 100_000,
      cashMethod: 'CHEQUE',
    });
    const photo = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await api(driver).collect(assignment.id, { amount: 'abc', method: 'CHEQUE' }).expect(400);
    const declared = (
      await api(driver)
        .collect(assignment.id, { amount: '100000', method: 'CHEQUE', reference: '0012345' }, photo)
        .expect(200)
    ).body as MissionBody;
    expect(declared.cashCollection).toMatchObject({
      canDeclare: false,
      declaration: { amount: 100_000, status: 'PENDING', hasPhoto: true },
    });
    const again = await api(driver)
      .collect(assignment.id, { amount: '100000', method: 'CHEQUE' })
      .expect(400);
    expect(again.body).toMatchObject({ code: 'MISSION_NOT_ALLOWED' });

    // En attente : ne compte pas, sans reçu ; montant et affectation figés
    const pending = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(pending.received).toBe(0);
    expect(pending.payments).toEqual([
      expect.objectContaining({
        pendingRemittance: true,
        receiptNumber: null,
        collectedBy: 'Youssef LIVREUR',
      }),
    ]);
    const frozen = await api(admin)
      .put(`/assignments/${assignment.id}`, {
        staffRole: 'DRIVER',
        startsAt: `${today}T00:00`,
        endsAt: `${today}T23:59`,
        force: true,
        cashToCollect: 90_000,
        cashMethod: 'CHEQUE',
      })
      .expect(409);
    expect(frozen.body).toMatchObject({ code: 'CASH_DECLARED' });
    await api(admin).delete(`/assignments/${assignment.id}`).expect(409);

    // Caisse livreurs : par livreur ; isolée par traiteur ; inaccessible au livreur
    const desk = (await api(admin).get('/cash-desk').expect(200)).body as Desk;
    const line = desk.drivers.find((item) => item.membershipId === driver.membershipId);
    expect(line).toMatchObject({ total: 100_000, cheques: 100_000 });
    const paymentId = line?.items[0]?.paymentId ?? '';
    expect((await api(otherAdmin).get('/cash-desk').expect(200)).body).toEqual({
      total: 0,
      drivers: [],
    });
    await api(otherAdmin).post(`/cash-desk/${paymentId}/remit`).expect(404);
    await api(driver).get('/cash-desk').expect(403);
    const photoUrl = (await api(admin).get(`/cash-desk/${paymentId}/cheque-photo`).expect(200))
      .body as { url: string };
    expect(photoUrl.url).toContain('cheques');

    // Remise : comptée, reçu numéroté ; une seconde validation est refusée
    const after = (await api(admin).post(`/cash-desk/${paymentId}/remit`).expect(200)).body as Desk;
    expect(after.drivers.some((item) => item.items.some((i) => i.paymentId === paymentId))).toBe(
      false,
    );
    const remitted = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(remitted.received).toBe(100_000);
    expect(remitted.payments[0]).toMatchObject({ pendingRemittance: false, remittedOn: today });
    expect(remitted.payments[0]?.receiptNumber).toMatch(/^REC-/);
    const twice = await api(admin).post(`/cash-desk/${paymentId}/remit`).expect(409);
    expect(twice.body).toMatchObject({ code: 'CASH_NOT_PENDING' });
    const mission = (await api(driver).get(`/me/missions/${assignment.id}`).expect(200))
      .body as MissionBody;
    expect(mission.cashCollection?.declaration?.status).toBe('REMITTED');

    // La base refuse toute modification d'un encaissement remis
    await expect(
      prisma.payment.update({ where: { id: paymentId }, data: { amount: 1 } }),
    ).rejects.toThrow();
  });

  it('refus : jamais compté, motif visible du livreur, qui peut déclarer à nouveau', async () => {
    const order = await createOrder();
    const assignment = await assignDriver(order.id, driver, {
      cashToCollect: 30_000,
      cashMethod: 'CASH',
    });
    await api(driver).collect(assignment.id, { amount: '20000', method: 'CASH' }).expect(200);
    const staffing = (await api(admin).get(`/orders/${order.id}/staffing`).expect(200))
      .body as Staffing;
    const declaration = staffing.assignments[0]?.cashDeclaration;
    expect(declaration).toMatchObject({ amount: 20_000, status: 'PENDING' });
    await api(admin)
      .post(`/cash-desk/${declaration?.paymentId}/reject`, { reason: '' })
      .expect(400);
    await api(admin)
      .post(`/cash-desk/${declaration?.paymentId}/reject`, { reason: 'Montant incomplet' })
      .expect(200);
    const payments = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(payments.received).toBe(0);

    const mission = (await api(driver).get(`/me/missions/${assignment.id}`).expect(200))
      .body as MissionBody;
    expect(mission.cashCollection).toMatchObject({
      canDeclare: true,
      declaration: { status: 'REJECTED', rejectReason: 'Montant incomplet' },
    });
    await api(driver).collect(assignment.id, { amount: '30000', method: 'CASH' }).expect(200);
    await api(admin).post(`/cash-desk/${declaration?.paymentId}/remit`).expect(409);
  });

  it('permission retirée au livreur : il voit le montant mais ne peut plus déclarer', async () => {
    const order = await createOrder();
    const assignment = await assignDriver(order.id, otherDriver, {
      cashToCollect: 40_000,
      cashMethod: 'CASH',
    });
    await api(admin)
      .put('/settings/permissions', {
        changes: [{ role: 'LIVREUR', key: 'deliveries.collect_cash', granted: false }],
      })
      .expect(200);
    try {
      const mission = (await api(otherDriver).get(`/me/missions/${assignment.id}`).expect(200))
        .body as MissionBody;
      expect(mission.cashCollection).toMatchObject({ amount: 40_000, canDeclare: false });
      await api(otherDriver)
        .collect(assignment.id, { amount: '40000', method: 'CASH' })
        .expect(403);
    } finally {
      await api(admin).post('/settings/permissions/reset', { role: 'LIVREUR' }).expect(200);
    }
    await api(otherDriver).collect(assignment.id, { amount: '40000', method: 'CASH' }).expect(200);
  });
});
