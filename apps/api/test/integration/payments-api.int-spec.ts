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

/** Encaissements, remboursements, reçus et échéancier par HTTP (application complète). */
interface Actor {
  token: string;
  traiteurId: string;
}

interface Payments {
  schedule: {
    installments: {
      kind: string;
      amount: number;
      dueDate: string | null;
      remaining: number;
      overdue: boolean;
    }[];
    paid: number;
    remaining: number;
    overdueAmount: number;
  };
  depositAmount: number;
  depositLocked: boolean;
  received: number;
  refunded: number;
  cancellationFee: number;
  payments: {
    id: string;
    type: string;
    amount: number;
    receiptNumber: string | null;
    voided: boolean;
  }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('API des paiements (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let otherAdmin: Actor;
  let clientId: string;

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `paiements-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        ice: '001234567000089',
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Test', lastName: role },
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

  /** Commande de 10 000,00 TTC (une ligne libre à 20 %), à `offset` jours. */
  const orderBody = (offset: number, status = 'CONFIRMED') => ({
    clientId,
    eventType: 'WEDDING',
    eventDate: casablancaDay(offset),
    startTime: '19:00',
    endTime: null,
    endsNextDay: false,
    guestCount: 100,
    venueName: null,
    venueAddress: '8, avenue Hassan II',
    city: 'Casablanca',
    notes: null,
    internalNotes: null,
    status,
    forceAvailability: true,
    lines: [
      {
        itemType: 'CUSTOM',
        label: { fr: 'Prestation' },
        quantity: 1,
        unitPrice: 1_000_000,
        taxRateBps: 2000,
        perPerson: false,
      },
    ],
  });

  async function createOrder(offset = 40, status = 'CONFIRMED') {
    const response = await api(admin).post('/orders', orderBody(offset, status)).expect(201);
    return response.body as { id: string; version: number; totalTtc: number; reference: string };
  }

  const pay = (actor: Actor, orderId: string, amount: number, paidOn = casablancaDay(0)) =>
    api(actor).post(`/orders/${orderId}/payments`, {
      amount,
      method: 'CASH',
      reference: null,
      paidOn,
      notes: null,
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
    const client = await api(admin)
      .post('/clients', {
        phone: randomPhone(),
        firstName: 'Nadia',
        lastName: 'Idrissi',
        email: null,
        locale: 'ar',
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

  it('acompte figé à la confirmation (30 % arrondi au dirham), solde à J-7', async () => {
    const order = await createOrder(40);
    const state = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(state).toMatchObject({ depositAmount: 300_000, depositLocked: true });
    expect(state.schedule.installments).toEqual([
      expect.objectContaining({ kind: 'DEPOSIT', amount: 300_000, dueDate: casablancaDay(0) }),
      expect.objectContaining({ kind: 'BALANCE', amount: 700_000, dueDate: casablancaDay(33) }),
    ]);
  });

  it('acompte figé aussi quand la commande est confirmée après coup (transition)', async () => {
    const order = await createOrder(50, 'PENDING');
    const before = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(before).toMatchObject({ depositAmount: 300_000, depositLocked: false });
    await api(admin)
      .post(`/orders/${order.id}/transitions`, {
        to: 'CONFIRMED',
        version: order.version,
        forceAvailability: true,
      })
      .expect(200);
    const after = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(after).toMatchObject({ depositAmount: 300_000, depositLocked: true });
  });

  it('encaissement : reçu numéroté, PDF figé et téléchargeable par URL signée', async () => {
    const order = await createOrder(41);
    const state = (await pay(employee, order.id, 300_000).expect(201)).body as Payments;
    const payment = state.payments[0];
    expect(payment).toMatchObject({ type: 'DEPOSIT', amount: 300_000 });
    expect(payment?.receiptNumber).toMatch(/^REC-\d{4}-\d{5}$/);
    expect(state.schedule).toMatchObject({ paid: 300_000, remaining: 700_000 });

    // Reçu généré juste après la réponse, ou au premier téléchargement
    const download = await api(admin)
      .get(`/orders/${order.id}/payments/${payment?.id ?? ''}/receipt`)
      .expect(200);
    const { url, fileName } = download.body as { url: string; fileName: string };
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment?.id ?? '' } });
    expect(row.receiptPdfKey).toMatch(/^private\/traiteurs\//);
    expect(row.receiptPdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fileName).toBe(`${payment?.receiptNumber ?? ''}.pdf`);
    const pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    // Le fichier stocké n'est jamais public (préfixe private/)
    const publicUrl = `${process.env.S3_PUBLIC_URL ?? ''}/${row.receiptPdfKey ?? ''}`;
    expect((await fetch(publicUrl)).status).toBe(403);
  });

  it('le total payé ne dépasse jamais le total TTC ; pas de date future', async () => {
    const order = await createOrder(42);
    await pay(admin, order.id, 600_000).expect(201);
    const exceeding = await pay(admin, order.id, 400_001).expect(400);
    expect(exceeding.body).toMatchObject({ code: 'PAYMENT_EXCEEDS_TOTAL', remaining: 400_000 });
    const future = await pay(admin, order.id, 1_000, casablancaDay(2)).expect(400);
    expect(future.body).toMatchObject({ code: 'PAYMENT_DATE_INVALID' });
    const full = (await pay(admin, order.id, 400_000).expect(201)).body as Payments;
    expect(full.schedule).toMatchObject({ paid: 1_000_000, remaining: 0 });
  });

  it('la base refuse un payé supérieur au total, une modification ou une suppression d’encaissement', async () => {
    const order = await createOrder(43);
    const state = (await pay(admin, order.id, 100_000).expect(201)).body as Payments;
    const paymentId = state.payments[0]?.id ?? '';
    await expect(
      prisma.payment.create({
        data: {
          traiteurId: admin.traiteurId,
          orderId: order.id,
          amount: 950_000,
          type: 'BALANCE',
          method: 'CASH',
          status: 'SUCCEEDED',
        },
      }),
    ).rejects.toThrow(/supérieur au total TTC/);
    await expect(
      prisma.payment.update({ where: { id: paymentId }, data: { amount: 1 } }),
    ).rejects.toThrow(/ne peut pas être modifié/);
    await expect(prisma.payment.delete({ where: { id: paymentId } })).rejects.toThrow(
      /ne se supprime pas/,
    );
  });

  it('remboursement plafonné au payé ; réservé à payments.refund', async () => {
    const order = await createOrder(44);
    await pay(admin, order.id, 300_000).expect(201);
    const refund = {
      amount: 100_000,
      method: 'BANK_TRANSFER',
      reference: 'VIR-1',
      paidOn: casablancaDay(0),
      notes: null,
    };
    await api(employee).post(`/orders/${order.id}/refunds`, refund).expect(403);
    const tooMuch = await api(admin)
      .post(`/orders/${order.id}/refunds`, { ...refund, amount: 300_001 })
      .expect(400);
    expect(tooMuch.body).toMatchObject({ code: 'REFUND_EXCEEDS_PAID' });
    const state = (await api(admin).post(`/orders/${order.id}/refunds`, refund).expect(201))
      .body as Payments;
    expect(state).toMatchObject({ received: 300_000, refunded: 100_000 });
    expect(state.schedule.paid).toBe(200_000);
  });

  it('annulation d’un encaissement saisi par erreur : motif, exclu des totaux, une seule fois', async () => {
    const order = await createOrder(45);
    const state = (await pay(admin, order.id, 250_000).expect(201)).body as Payments;
    const paymentId = state.payments[0]?.id ?? '';
    const voided = (
      await api(admin)
        .post(`/orders/${order.id}/payments/${paymentId}/void`, { reason: 'Saisie en double' })
        .expect(200)
    ).body as Payments;
    expect(voided.payments[0]).toMatchObject({ voided: true });
    expect(voided.schedule.paid).toBe(0);
    const again = await api(admin)
      .post(`/orders/${order.id}/payments/${paymentId}/void`, { reason: 'x' })
      .expect(400);
    expect(again.body).toMatchObject({ code: 'PAYMENT_VOIDED' });
    // Le reçu d'un encaissement annulé reste téléchargeable, marqué ANNULÉ
    await api(admin).get(`/orders/${order.id}/payments/${paymentId}/receipt`).expect(200);
  });

  it('le total d’une commande ne peut pas descendre sous le montant déjà payé', async () => {
    const order = await createOrder(46, 'PENDING');
    await pay(admin, order.id, 800_000).expect(201);
    const body = orderBody(46, 'PENDING');
    const { status: _status, forceAvailability: _force, ...fields } = body;
    const response = await api(admin)
      .put(`/orders/${order.id}`, {
        ...fields,
        version: ((await api(admin).get(`/orders/${order.id}`)).body as { version: number })
          .version,
        reason: null,
        lines: [{ ...body.lines[0], unitPrice: 500_000 }],
      })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'TOTAL_BELOW_PAID', paid: 800_000 });
  });

  it('annulation d’une commande payée : remboursement choisi, le reste en frais d’annulation', async () => {
    const order = await createOrder(47);
    await pay(admin, order.id, 300_000).expect(201);
    const current = (await api(admin).get(`/orders/${order.id}`)).body as { version: number };
    const transition = (refund: object | null) =>
      api(admin).post(`/orders/${order.id}/transitions`, {
        to: 'CANCELLED',
        reason: 'Événement annulé',
        version: current.version,
        refund,
      });
    const missing = await transition(null).expect(400);
    expect(missing.body).toMatchObject({ code: 'REFUND_REQUIRED', paid: 300_000 });
    await transition({
      amount: 300_001,
      method: 'CASH',
      reference: null,
      paidOn: casablancaDay(0),
    }).expect(400);
    await transition({
      amount: 200_000,
      method: 'CASH',
      reference: null,
      paidOn: casablancaDay(0),
    }).expect(200);

    const state = (await api(admin).get(`/orders/${order.id}/payments`).expect(200))
      .body as Payments;
    expect(state).toMatchObject({ received: 300_000, refunded: 200_000, cancellationFee: 100_000 });
    expect(state.schedule).toMatchObject({ installments: [], remaining: 0 });
    const after = await pay(admin, order.id, 1_000).expect(400);
    expect(after.body).toMatchObject({ code: 'PAYMENT_NOT_ALLOWED' });
  });

  it('retards : liste filtrée et carte « Impayés », « Encaissé ce mois »', async () => {
    const order = await createOrder(20);
    // Confirmée il y a 3 jours, acompte toujours dû : en retard
    await prisma.order.update({
      where: { id: order.id },
      data: { confirmedAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const overdue = await api(admin).get('/orders?payment=overdue&pageSize=100').expect(200);
    const listed = (
      overdue.body as { items: { id: string; overdueAmount: number; paid: number }[] }
    ).items.find((item) => item.id === order.id);
    expect(listed).toMatchObject({ overdueAmount: 300_000, paid: 0 });

    const dashboard = (await api(admin).get('/dashboard').expect(200)).body as {
      unpaid: { amount: number; count: number };
      monthCollected: { amount: number; count: number };
    };
    expect(dashboard.unpaid.amount).toBeGreaterThanOrEqual(300_000);
    expect(dashboard.unpaid.count).toBeGreaterThanOrEqual(1);
    expect(dashboard.monthCollected.amount).toBeGreaterThan(0);

    await pay(admin, order.id, 300_000).expect(201);
    const after = await api(admin).get('/orders?payment=overdue&pageSize=100').expect(200);
    expect((after.body as { items: { id: string }[] }).items.map((item) => item.id)).not.toContain(
      order.id,
    );
  });

  it('acompte ajustable par le traiteur', async () => {
    const order = await createOrder(48);
    const state = (
      await api(admin).put(`/orders/${order.id}/deposit`, { depositAmount: 450_000 }).expect(200)
    ).body as Payments;
    expect(state.schedule.installments[0]).toMatchObject({ kind: 'DEPOSIT', amount: 450_000 });
    await api(employee).put(`/orders/${order.id}/deposit`, { depositAmount: 1 }).expect(200);
    await api(admin).put(`/orders/${order.id}/deposit`, { depositAmount: 1_000_001 }).expect(400);
  });

  it('isolation : un autre traiteur ne voit ni n’encaisse les paiements', async () => {
    const order = await createOrder(49);
    await api(otherAdmin).get(`/orders/${order.id}/payments`).expect(404);
    await pay(otherAdmin, order.id, 1_000).expect(404);
  });
});
