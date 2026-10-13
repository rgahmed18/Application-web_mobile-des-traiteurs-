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
import {
  DocumentRecoveryService,
  RECOVERY_GRACE_MS,
} from '../../src/document-recovery/document-recovery.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { StorageService } from '../../src/storage/storage.service';
import { createTestPrisma } from './helpers';

/**
 * Stockage en panne APRÈS le commit : la facture, le reçu et le devis envoyé existent (la
 * requête réussit), sans PDF ; la reprise automatique les produit une fois le stockage revenu.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('Reprise automatique des PDF (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: StorageService;
  let recovery: DocumentRecoveryService;
  let token: string;
  let clientId: string;

  const server = (): App => app.getHttpServer() as App;
  const post = (path: string, body?: object) =>
    request(server()).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);

  /** Reprise lancée comme si le délai de grâce était écoulé. */
  const recoverNow = () => recovery.recover(new Date(Date.now() + RECOVERY_GRACE_MS + 60_000));

  /** Stockage indisponible pendant `run`, puis rétabli. */
  async function withStorageDown<T>(run: () => Promise<T>): Promise<T> {
    const spy = jest
      .spyOn(storage, 'putPrivate')
      .mockRejectedValue(new Error('Stockage indisponible (test)'));
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  async function createOrder() {
    const response = await post('/orders', {
      clientId,
      eventType: 'CORPORATE',
      eventDate: casablancaDay(45),
      startTime: '12:00',
      endTime: null,
      endsNextDay: false,
      guestCount: 40,
      venueName: null,
      venueAddress: '8, avenue Hassan II',
      city: 'Casablanca',
      notes: null,
      internalNotes: null,
      status: 'CONFIRMED',
      forceAvailability: true,
      lines: [
        {
          itemType: 'CUSTOM',
          label: { fr: 'Déjeuner' },
          quantity: 40,
          unitPrice: 10_000,
          taxRateBps: 2000,
          perPerson: true,
        },
      ],
    }).expect(201);
    return response.body as { id: string };
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    storage = app.get(StorageService);
    recovery = app.get(DocumentRecoveryService);

    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `reprise-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        legalName: 'Réceptions Test SARL',
        ice: '001234567000089',
      },
    });
    await prisma.featureFlag.createMany({
      data: ['invoices', 'quotes'].map((key) => ({ traiteurId: traiteur.id, key, enabled: true })),
    });
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Test', lastName: 'Admin' },
    });
    const membership = await prisma.membership.create({
      data: {
        traiteurId: traiteur.id,
        userId: user.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'Test',
        lastName: 'Admin',
      },
    });
    token = (
      await app
        .get(TokenService)
        .issueTokens(
          user.id,
          false,
          { traiteurId: traiteur.id, membershipId: membership.id, role: 'ADMIN_TRAITEUR' },
          { ipAddress: '127.0.0.1', userAgent: 'jest' },
        )
    ).accessToken;
    const client = await post('/clients', {
      phone: randomPhone(),
      firstName: 'Omar',
      lastName: 'Alaoui',
      email: null,
      locale: 'fr',
      tags: [],
      internalNotes: null,
      address: null,
    }).expect(201);
    clientId = (client.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('facture et reçu émis malgré la panne du stockage, PDF repris ensuite', async () => {
    const order = await createOrder();
    const issued = await withStorageDown(async () => {
      await post(`/orders/${order.id}/invoices`, { kind: 'DEPOSIT' }).expect(201);
      await post(`/orders/${order.id}/payments`, {
        amount: 50_000,
        method: 'CASH',
        reference: null,
        paidOn: casablancaDay(0),
        notes: null,
      }).expect(201);
      // Laisse échouer la génération du reçu lancée en arrière-plan
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      return {
        invoice: await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } }),
        payment: await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } }),
      };
    });
    expect(issued.invoice.number).toMatch(/^FAC-/);
    expect(issued.invoice.pdfKey).toBeNull();
    expect(issued.payment.receiptNumber).toMatch(/^REC-/);
    expect(issued.payment.receiptPdfKey).toBeNull();

    // Pas encore de reprise pendant le délai de grâce
    await recovery.recover();
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: issued.invoice.id } })).pdfKey,
    ).toBeNull();

    const report = await recoverNow();
    expect(report.invoices).toBeGreaterThanOrEqual(1);
    expect(report.receipts).toBeGreaterThanOrEqual(1);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: issued.invoice.id } });
    expect(invoice.pdfKey).toMatch(/invoices\/FAC-/);
    expect(invoice.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: issued.payment.id } });
    expect(payment.receiptPdfKey).toMatch(/receipts\/REC-/);

    // Idempotent : un second passage ne touche plus à ces documents
    const again = await recoverNow();
    const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchanged.pdfSha256).toBe(invoice.pdfSha256);
    expect(again.failed).toBe(0);
  });

  it('devis envoyé malgré la panne du stockage, PDF « tel qu’envoyé » repris ensuite', async () => {
    const order = await createOrder();
    const quote = (await post(`/orders/${order.id}/quotes`, {}).expect(201)).body as { id: string };
    await withStorageDown(() => post(`/quotes/${quote.id}/send`).expect(200));
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).pdfKey).toBeNull();

    await recoverNow();
    const recovered = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(recovered.pdfKey).toMatch(/quotes\/.+\.pdf$/);
    expect(recovered.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
