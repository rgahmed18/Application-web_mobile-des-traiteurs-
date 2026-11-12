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
 * Espace client et isolation : demandes, devis (accepté depuis l'espace), factures, reçus,
 * profil et adresses ; un autre client du même traiteur ou un client d'un autre traiteur ne
 * voit jamais rien (404), et aucune donnée interne n'est envoyée au client.
 */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const inDays = (days: number) => addDays(todayInTimeZone('Africa/Casablanca'), days);

describe('Espace client et isolation (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let customer: Actor;
  let neighbour: Actor;
  let elsewhere: Actor;
  let serviceId: string;
  let orderId: string;
  let quoteId: string;

  const server = (): App => app.getHttpServer() as App;
  const ip = () => `41.254.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(server())
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .set('X-Forwarded-For', ip()),
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .set('X-Forwarded-For', ip())
        .send(body),
    put: (path: string, body: object) =>
      request(server())
        .put(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .set('X-Forwarded-For', ip())
        .send(body),
    delete: (path: string) =>
      request(server())
        .delete(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .set('X-Forwarded-For', ip()),
  });

  async function createTraiteur() {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `espace-${suffix}`,
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

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteur = await createTraiteur();
    await prisma.featureFlag.createMany({
      data: ['invoices', 'quotes'].map((key) => ({ traiteurId: traiteur.id, key, enabled: true })),
    });
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    customer = await actorFor(traiteur.id, 'CLIENT', 'Salma');
    neighbour = await actorFor(traiteur.id, 'CLIENT', 'Voisin');
    elsewhere = await actorFor((await createTraiteur()).id, 'CLIENT', 'Ailleurs');
    serviceId = (
      (
        await api(admin)
          .post('/catalog/services', {
            name: { fr: 'Décoration' },
            description: null,
            price: 500_000,
            taxRateBps: null,
            pricingUnit: 'FLAT',
            isActive: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;

    // Demande du client, devis préparé et envoyé par le traiteur
    orderId = (
      (
        await api(customer)
          .post('/client/requests', {
            eventType: 'WEDDING',
            eventDate: inDays(60),
            startTime: '19:00',
            endTime: null,
            endsNextDay: false,
            guestCount: 80,
            venueName: null,
            venueAddress: '3 rue des Orangers',
            city: 'Fès',
            saveAddressAs: null,
            onSiteContactName: null,
            onSiteContactPhone: null,
            notes: null,
            items: [{ kind: 'service', id: serviceId, quantity: 1 }],
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    await prisma.order.update({
      where: { id: orderId },
      data: { internalNotes: 'Client exigeant (note interne)', serviceNotes: 'Code portail 4521' },
    });
    quoteId = (
      (await api(admin).post(`/orders/${orderId}/quotes`, {}).expect(201)).body as { id: string }
    ).id;
    await api(admin).post(`/quotes/${quoteId}/send`).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('accueil et demande : devis à traiter, lignes, historique ; aucune donnée interne', async () => {
    const dashboard = (await api(customer).get('/client/dashboard').expect(200)).body as {
      activeOrders: { id: string; quoteToAnswer: boolean }[];
      quotesToAnswer: { id: string }[];
    };
    expect(dashboard.activeOrders).toEqual([
      expect.objectContaining({ id: orderId, quoteToAnswer: true }),
    ]);
    expect(dashboard.quotesToAnswer.map((quote) => quote.id)).toEqual([quoteId]);

    const order = await api(customer).get(`/client/orders/${orderId}`).expect(200);
    expect(order.body).toMatchObject({
      status: 'QUOTED',
      lines: [expect.objectContaining({ label: { fr: 'Décoration' }, totalTtc: 500_000 })],
      history: [
        expect.objectContaining({ toStatus: 'PENDING', byClient: true }),
        expect.objectContaining({ toStatus: 'QUOTED', byClient: false }),
      ],
      cancellable: false,
    });
    const raw = JSON.stringify(order.body);
    for (const hidden of ['note interne', '4521', 'internalNotes', 'serviceNotes', 'actorName']) {
      expect(raw).not.toContain(hidden);
    }
  });

  it('isolation : un autre client du traiteur ou d’un autre traiteur ne voit rien (404)', async () => {
    for (const intruder of [neighbour, elsewhere]) {
      await api(intruder).get(`/client/orders/${orderId}`).expect(404);
      await api(intruder).get(`/client/quotes/${quoteId}`).expect(404);
      await api(intruder).get(`/client/quotes/${quoteId}/pdf`).expect(404);
      await api(intruder)
        .post(`/client/quotes/${quoteId}/accept`, { name: 'Intrus', consent: true })
        .expect(404);
      await api(intruder).post(`/client/quotes/${quoteId}/reject`, { reason: null }).expect(404);
      await api(intruder).post(`/client/requests/${orderId}/cancel`).expect(404);
      expect((await api(intruder).get('/client/orders').expect(200)).body).toEqual([]);
      expect((await api(intruder).get('/client/quotes').expect(200)).body).toEqual([]);
    }
    // Le personnel n'utilise pas l'espace client ; le client n'entre pas au back-office
    await api(admin).get('/client/orders').expect(403);
    await api(customer).get(`/orders/${orderId}`).expect(403);
    await api(customer).get(`/quotes/${quoteId}/pdf`).expect(403);
  });

  it('devis accepté depuis l’espace : commande confirmée, historique visible des deux côtés', async () => {
    const view = await api(customer).get(`/client/quotes/${quoteId}`).expect(200);
    expect((view.body as { status: string }).status).toBe('SENT');
    const pdf = await api(customer).get(`/client/quotes/${quoteId}/pdf`).expect(200);
    expect((pdf.body as { fileName: string }).fileName).toMatch(/^DEV-.*\.pdf$/);

    const accepted = await api(customer)
      .post(`/client/quotes/${quoteId}/accept`, { name: 'Salma CLIENT', consent: true })
      .expect(200);
    expect((accepted.body as { status: string }).status).toBe('ACCEPTED');
    const order = (await api(customer).get(`/client/orders/${orderId}`).expect(200)).body as {
      status: string;
      installments: { kind: string }[];
    };
    expect(order.status).toBe('CONFIRMED');
    expect(order.installments.length).toBeGreaterThan(0);

    const staffHistory = (await api(admin).get(`/orders/${orderId}/history`).expect(200)).body as {
      kind?: string;
      label?: string;
      actorName?: string | null;
    }[];
    expect(JSON.stringify(staffHistory)).toContain('Salma CLIENT (client, en ligne)');
  });

  it('paiements, reçus et factures : visibles et téléchargeables par leur seul client', async () => {
    const payment = await api(admin)
      .post(`/orders/${orderId}/payments`, {
        amount: 150_000,
        method: 'CASH',
        reference: null,
        paidOn: inDays(0),
        notes: null,
      })
      .expect(201);
    expect(payment.status).toBe(201);
    await api(admin)
      .post(`/orders/${orderId}/invoices`, { kind: 'TOTAL', notes: null })
      .expect(201);

    const payments = (await api(customer).get('/client/payments').expect(200)).body as {
      id: string;
      amount: number;
      receiptNumber: string | null;
    }[];
    expect(payments).toEqual([expect.objectContaining({ amount: 150_000 })]);
    const paymentId = payments[0]?.id ?? '';
    expect(payments[0]?.receiptNumber).toMatch(/^REC-/);
    await api(customer).get(`/client/payments/${paymentId}/receipt`).expect(200);
    await api(neighbour).get(`/client/payments/${paymentId}/receipt`).expect(404);

    const invoices = (await api(customer).get('/client/invoices').expect(200)).body as {
      id: string;
      number: string;
    }[];
    expect(invoices).toHaveLength(1);
    const invoiceId = invoices[0]?.id ?? '';
    await api(customer).get(`/client/invoices/${invoiceId}/pdf`).expect(200);
    await api(elsewhere).get(`/client/invoices/${invoiceId}/pdf`).expect(404);
    expect((await api(neighbour).get('/client/payments').expect(200)).body).toEqual([]);
    expect((await api(neighbour).get('/client/invoices').expect(200)).body).toEqual([]);
  });

  it('profil et adresses : propres à ce traiteur, jamais modifiables par un autre client', async () => {
    const updated = await api(customer)
      .put('/client/account', {
        firstName: 'Salma',
        lastName: 'Bennani',
        email: 'salma@exemple.ma',
        locale: 'ar',
      })
      .expect(200);
    expect(updated.body).toMatchObject({ lastName: 'Bennani', locale: 'ar' });
    const user = await prisma.membership.findUniqueOrThrow({
      where: { id: customer.membershipId },
      include: { user: true },
    });
    // Le compte global ne change pas (fiche propre à ce traiteur)
    expect(user.user.lastName).toBe('CLIENT');

    const addresses = (
      await api(customer)
        .post('/client/addresses', {
          label: 'Maison',
          address: '3 rue des Orangers',
          city: 'Fès',
          isDefault: true,
        })
        .expect(201)
    ).body as { id: string }[];
    const addressId = addresses[0]?.id ?? '';
    await api(neighbour).delete(`/client/addresses/${addressId}`).expect(404);
    await api(neighbour)
      .put(`/client/addresses/${addressId}`, {
        label: 'Volée',
        address: 'x',
        city: 'y',
        isDefault: false,
      })
      .expect(404);
    expect((await api(customer).delete(`/client/addresses/${addressId}`).expect(200)).body).toEqual(
      [],
    );
  });
});
