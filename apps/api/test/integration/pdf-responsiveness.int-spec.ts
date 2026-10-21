import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import { deliveryNoteDocument } from '../../src/assignments/delivery-note';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { PdfRenderPool, PdfRenderTimeoutError } from '../../src/pdf/pdf-render-pool';
import { ASSETS_DIR, PdfService } from '../../src/pdf/pdf.service';
import { sellerSelect } from '../../src/pdf/seller';
import { createTestPrisma } from './helpers';

/**
 * Le rendu Typst (synchrone) tourne dans un pool de threads : pendant qu'un lot de PDF est
 * généré, l'API continue de répondre vite et sa boucle d'événements n'est jamais bloquée.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Documents du lot, et requêtes /health envoyées pendant sa génération (limiteur : 100/min). */
const BATCH = 8;
const MAX_PROBES = 40;

describe('Réactivité de l’API pendant la génération de PDF', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pdf: PdfService;
  let token: string;
  let orderId: string;
  let slug: string;

  const server = (): App => app.getHttpServer() as App;
  const authed = (path: string) =>
    request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    pdf = app.get(PdfService);

    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: (slug = `pdf-${suffix}`),
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
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
    const client = await request(server())
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: randomPhone(),
        firstName: 'Salma',
        lastName: 'Bennani',
        email: null,
        locale: 'ar',
        tags: [],
        internalNotes: null,
        address: null,
      })
      .expect(201);
    // Commande de 150 lignes en français et en arabe : un bon de livraison de plusieurs pages
    const order = await request(server())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId: (client.body as { id: string }).id,
        eventType: 'WEDDING',
        eventDate: casablancaDay(60),
        startTime: '20:00',
        endTime: null,
        endsNextDay: false,
        guestCount: 300,
        venueName: 'Salle Les Jasmins',
        venueAddress: '8, avenue Hassan II',
        city: 'Casablanca',
        notes: null,
        internalNotes: null,
        status: 'CONFIRMED',
        forceAvailability: true,
        lines: Array.from({ length: 150 }, (_, index) => ({
          itemType: 'CUSTOM',
          label: { fr: `Plat ${index + 1} — sauce et garniture`, ar: `طبق رقم ${index + 1}` },
          quantity: 300,
          unitPrice: 1_000,
          taxRateBps: 2000,
          perPerson: true,
        })),
      })
      .expect(201);
    orderId = (order.body as { id: string }).id;
    // Threads lancés et polices chargées : la mesure porte sur le rendu, pas sur le démarrage
    await authed(`/orders/${orderId}/delivery-note`).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('répond pendant qu’un lot de PDF est en cours de génération', async () => {
    // Documents lourds (4 000 lignes) : sur le thread principal, chacun le bloquerait ~0,3 s
    const seller = await prisma.traiteur.findUniqueOrThrow({
      where: { slug },
      select: sellerSelect,
    });
    const model = deliveryNoteDocument({
      locale: 'ar',
      seller,
      hasLogo: false,
      reference: 'CMD-2026-99999',
      eventTypeName: { fr: 'Mariage', ar: 'عرس' },
      date: casablancaDay(60),
      startTime: '20:00',
      deliveryTime: '17:00',
      guestCount: 300,
      venue: { name: 'Salle Les Jasmins', address: '8, avenue Hassan II', city: 'Casablanca' },
      contact: { name: 'Salma Bennani', phone: '+212600000000' },
      lines: Array.from({ length: 4_000 }, (_, index) => ({
        label: { fr: `Plat ${index + 1} — sauce et garniture`, ar: `طبق رقم ${index + 1}` },
        quantity: 300,
      })),
      equipment: [],
      serviceNotes: null,
      clientNotes: null,
    });

    let done = false;
    const batch = Promise.all(Array.from({ length: BATCH }, () => pdf.render(model))).finally(
      () => {
        done = true;
      },
    );
    const latencies: number[] = [];
    let probesWhileBusy = 0;
    while (!done && latencies.length < MAX_PROBES) {
      const busy = pdf.stats().busy > 0;
      const before = performance.now();
      await request(server()).get('/api/v1/health').expect(200);
      latencies.push(performance.now() - before);
      if (busy) probesWhileBusy += 1;
      await sleep(25);
    }
    const documents = await batch;
    const slowest = Math.max(...latencies);

    expect(documents.every((document) => document.pdf.subarray(0, 5).toString() === '%PDF-')).toBe(
      true,
    );
    // Rendu déterministe : même document, même empreinte, quel que soit le thread
    expect(new Set(documents.map((document) => document.sha256)).size).toBe(1);
    expect(probesWhileBusy).toBeGreaterThanOrEqual(5);
    expect(slowest).toBeLessThan(150);
  });

  it('les PDF demandés par HTTP aboutissent pendant que l’API continue de répondre', async () => {
    const batch = Promise.all(
      Array.from({ length: 6 }, () => authed(`/orders/${orderId}/delivery-note`)),
    );
    const health = await request(server()).get('/api/v1/health').expect(200);
    expect((health.body as { status: string }).status).toBe('ok');
    const responses = await batch;
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));
  });

  it('un rendu trop long est interrompu, son thread remplacé, et le pool reste utilisable', async () => {
    const pool = new PdfRenderPool({
      assetsDir: ASSETS_DIR,
      template: readFileSync(join(ASSETS_DIR, 'templates', 'document.typ'), 'utf8'),
      size: 1,
      timeoutMs: 1,
      log: () => undefined,
    });
    try {
      await expect(pool.render({}, null)).rejects.toBeInstanceOf(PdfRenderTimeoutError);
      expect(pool.stats()).toEqual({ threads: 0, busy: 0, queued: 0 });
      // Les documents suivants repartent sur un thread neuf (lui aussi interrompu à 1 ms)
      await expect(pool.render({}, null)).rejects.toBeInstanceOf(PdfRenderTimeoutError);
    } finally {
      await pool.close();
    }
    // Le pool de l'API, lui, n'a pas été affecté
    await authed(`/orders/${orderId}/delivery-note`).expect(200);
    expect(pdf.stats().busy).toBe(0);
  });
});
