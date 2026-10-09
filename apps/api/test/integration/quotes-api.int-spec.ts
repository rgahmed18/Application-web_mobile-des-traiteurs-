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
import { QuotesService } from '../../src/quotes/quotes.service';
import { REDIS_CLIENT } from '../../src/redis/redis.module';
import { createTestPrisma } from './helpers';

/** Devis par HTTP : versions, envoi, lien public, accord en ligne ou manuel, refus, expiration. */
interface Actor {
  token: string;
  traiteurId: string;
}

interface QuoteBody {
  id: string;
  reference: string;
  version: number;
  status: string;
  totalTtc: number;
  validUntil: string;
  availabilityPending: boolean;
  supersededReason: string | null;
  linkActive: boolean;
  linkViews: number;
  acceptance: {
    mode: string;
    name: string;
    recordedBy: string | null;
    hasAttachment: boolean;
    note: string | null;
  } | null;
}

interface PublicQuoteBody {
  reference: string;
  status: string;
  clientName: string;
  totalTtc: number;
  amountInWords: string;
  terms: string | null;
  depositAmount: number;
  acceptance: { name: string } | null;
  availabilityPending: boolean;
  lines: { label: string; total: number }[];
}

interface OrderBody {
  id: string;
  version: number;
  status: string;
  depositAmount: number;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('API des devis (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let driver: Actor;
  let otherAdmin: Actor;
  let clientId: string;
  let traiteurId: string;

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `devis-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        maxEventsPerDay: 1,
        quoteTerms: { fr: 'Acompte de 30 % à la confirmation.', ar: 'تسبيق 30٪ عند التأكيد.' },
      },
    });
    await prisma.featureFlag.create({
      data: { traiteurId: traiteur.id, key: 'quotes', enabled: true },
    });
    return traiteur.id;
  }

  async function actorFor(tenantId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Test', lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId: tenantId, userId: user.id, role, firstName: 'Karim', lastName: role },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId: tenantId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId: tenantId };
  }

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      patch: (path: string, body: object) =>
        auth(request(server()).patch(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
      multipart: (path: string) => auth(request(server()).post(`/api/v1${path}`)),
    };
  };
  const publicApi = {
    get: (path: string) => request(server()).get(`/api/v1/public/quotes/${path}`),
    post: (path: string, body: object) =>
      request(server()).post(`/api/v1/public/quotes/${path}`).send(body),
  };

  const orderBody = (offset: number, status: string) => ({
    clientId,
    eventType: 'WEDDING',
    eventDate: casablancaDay(offset),
    startTime: '19:00',
    endTime: '02:00',
    endsNextDay: true,
    guestCount: 120,
    venueName: 'Salle Les Jasmins',
    venueAddress: '8, avenue Hassan II',
    city: 'Casablanca',
    notes: null,
    internalNotes: null,
    status,
    forceAvailability: true,
    lines: [
      {
        itemType: 'CUSTOM',
        label: 'Menu mariage',
        quantity: 120,
        unitPrice: 25_000,
        taxRateBps: 2000,
        perPerson: true,
      },
      {
        itemType: 'CUSTOM',
        label: 'Service',
        quantity: 1,
        unitPrice: 200_000,
        taxRateBps: 2000,
        perPerson: false,
      },
    ],
  });

  async function createOrder(offset: number, status = 'PENDING'): Promise<OrderBody> {
    return (await api(admin).post('/orders', orderBody(offset, status)).expect(201))
      .body as OrderBody;
  }

  const getOrder = async (id: string) =>
    (await api(admin).get(`/orders/${id}`).expect(200)).body as OrderBody;

  async function sentQuote(offset: number) {
    const order = await createOrder(offset);
    const draft = (await api(admin).post(`/orders/${order.id}/quotes`, {}).expect(201))
      .body as QuoteBody;
    const sent = (await api(admin).post(`/quotes/${draft.id}/send`).expect(200)).body as {
      quote: QuoteBody;
      link: { url: string; expiresAt: string };
    };
    const token = sent.link.url.split('/devis/')[1] ?? '';
    return { order, quote: sent.quote, token };
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    traiteurId = await createTraiteur();
    admin = await actorFor(traiteurId, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteurId, 'EMPLOYE');
    driver = await actorFor(traiteurId, 'LIVREUR');
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
    const client = await api(admin)
      .post('/clients', {
        phone: randomPhone(),
        firstName: 'Salma',
        lastName: 'Bennani',
        email: 'salma@exemple.ma',
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

  it('brouillon : lignes de la commande, PDF d’aperçu, puis envoi → commande « Devis envoyé »', async () => {
    const order = await createOrder(60);
    const draft = (await api(employee).post(`/orders/${order.id}/quotes`, {}).expect(201))
      .body as QuoteBody;
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1, totalTtc: 3_200_000 });
    expect(draft.reference).toMatch(/^DEV-\d{4}-\d{5}$/);
    expect(draft.validUntil).toBe(casablancaDay(15));

    const preview = (await api(admin).get(`/quotes/${draft.id}/pdf`).expect(200)).body as {
      url: string;
    };
    const pdf = Buffer.from(await (await fetch(preview.url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const sent = (await api(admin).post(`/quotes/${draft.id}/send`).expect(200)).body as {
      quote: QuoteBody;
      link: { url: string; expiresAt: string };
    };
    expect(sent.quote).toMatchObject({ status: 'SENT', linkActive: true });
    expect(sent.link.url).toMatch(/\/devis\/[A-Za-z0-9_-]{43}$/);
    expect((await getOrder(order.id)).status).toBe('QUOTED');

    // PDF figé une fois pour toutes, avec son empreinte et la version du gabarit
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.pdfKey).toMatch(/^private\/traiteurs\//);
    expect(row.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.pdfTemplate).toBe('document@1');
    // Seule l'empreinte du jeton est conservée
    const token = sent.link.url.split('/devis/')[1] ?? '';
    const links = await prisma.quoteLink.findMany({ where: { quoteId: draft.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.tokenHash).not.toContain(token);

    // Lignes figées par la base une fois le devis envoyé
    await expect(
      prisma.quoteLine.updateMany({ where: { quoteId: draft.id }, data: { label: 'Modifié' } }),
    ).rejects.toThrow(/devis envoyé/);
    await api(admin)
      .patch(`/quotes/${draft.id}`, { validUntil: casablancaDay(20), locale: 'fr', notes: null })
      .expect(400);
  });

  it('page publique : en-têtes noindex / no-referrer, jeton invalide → 404', async () => {
    const { token } = await sentQuote(61);
    const view = await publicApi.get(token).expect(200);
    expect(view.headers['x-robots-tag']).toContain('noindex');
    expect(view.headers['referrer-policy']).toBe('no-referrer');
    expect(view.headers['cache-control']).toBe('no-store');
    const body = view.body as PublicQuoteBody;
    expect(body).toMatchObject({
      status: 'SENT',
      clientName: 'Salma Bennani',
      totalTtc: 3_200_000,
    });
    expect(body.amountInWords).toBe('Trente-deux mille dirhams');
    expect(body.depositAmount).toBe(960_000);
    expect(body.lines.map((line) => line.label)).toEqual(['Menu mariage', 'Service']);
    expect(body.terms).toBe('Acompte de 30 % à la confirmation.');
    // Le client peut lire le devis dans l'autre langue (montant en lettres et conditions)
    const ar = (await publicApi.get(`${token}?lang=ar`).expect(200)).body as PublicQuoteBody;
    expect(ar.amountInWords).toBe('اثنان وثلاثون ألف درهم');
    expect(ar.terms).toBe('تسبيق 30٪ عند التأكيد.');

    const missing = await publicApi.get('A'.repeat(43)).expect(404);
    expect(missing.headers['x-robots-tag']).toContain('noindex');
    await publicApi.get('trop-court').expect(404);

    const pdf = await publicApi.get(`${token}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('accord en ligne → commande confirmée, acompte figé, trace IP / navigateur / nom', async () => {
    const { order, quote, token } = await sentQuote(62);
    const accepted = (
      await publicApi
        .post(`${token}/accept`, { name: 'Salma Bennani', consent: true })
        .set('User-Agent', 'Navigateur-Test')
        .expect(200)
    ).body as PublicQuoteBody;
    expect(accepted).toMatchObject({
      status: 'ACCEPTED',
      acceptance: { name: 'Salma Bennani' },
      availabilityPending: false,
    });
    const after = await getOrder(order.id);
    expect(after).toMatchObject({ status: 'CONFIRMED', depositAmount: 960_000 });

    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(row).toMatchObject({
      acceptanceMode: 'ONLINE',
      acceptedName: 'Salma Bennani',
      acceptedUserAgent: 'Navigateur-Test',
    });
    expect(row.acceptedIp).toBeTruthy();
    const history = await prisma.orderStatusChange.findFirst({
      where: { orderId: order.id, toStatus: 'CONFIRMED' },
    });
    expect(history?.actorName).toBe('Salma Bennani (client, en ligne)');

    // Une seule réponse : un second accord est refusé
    await publicApi.post(`${token}/accept`, { name: 'Salma', consent: true }).expect(400);
    // Consentement obligatoire
    const other = await sentQuote(63);
    await publicApi.post(`${other.token}/accept`, { name: 'Salma', consent: false }).expect(400);
  });

  it('accord sur un jour complet : accord enregistré, date à confirmer par le traiteur', async () => {
    await createOrder(64, 'CONFIRMED'); // capacité 1 : jour complet
    const { order, quote, token } = await sentQuote(64);
    const accepted = (
      await publicApi.post(`${token}/accept`, { name: 'Salma Bennani', consent: true }).expect(200)
    ).body as PublicQuoteBody;
    expect(accepted).toMatchObject({ status: 'ACCEPTED', availabilityPending: true });
    expect((await getOrder(order.id)).status).toBe('QUOTED');

    const dashboard = (await api(admin).get('/dashboard').expect(200)).body as {
      quotesToConfirm: number;
    };
    expect(dashboard.quotesToConfirm).toBeGreaterThanOrEqual(1);

    // Le traiteur confirme malgré tout : l'alerte disparaît
    const current = await getOrder(order.id);
    await api(admin)
      .post(`/orders/${order.id}/transitions`, {
        to: 'CONFIRMED',
        version: current.version,
        forceAvailability: true,
      })
      .expect(200);
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(row.availabilityPending).toBe(false);
  });

  it('refus en ligne → commande « En attente », motif conservé', async () => {
    const { order, quote, token } = await sentQuote(65);
    const rejected = (
      await publicApi.post(`${token}/reject`, { reason: 'Budget trop élevé' }).expect(200)
    ).body as PublicQuoteBody;
    expect(rejected.status).toBe('REJECTED');
    expect((await getOrder(order.id)).status).toBe('PENDING');
    const list = (await api(admin).get(`/orders/${order.id}/quotes`).expect(200))
      .body as (QuoteBody & { rejectionReason: string })[];
    expect(list[0]).toMatchObject({ id: quote.id, rejectionReason: 'Budget trop élevé' });
  });

  it('nouvelle version : même référence v2, la v1 est remplacée et son lien révoqué', async () => {
    const { order, quote, token } = await sentQuote(66);
    const v2 = (await api(admin).post(`/orders/${order.id}/quotes`, {}).expect(201))
      .body as QuoteBody;
    expect(v2).toMatchObject({ reference: quote.reference, version: 2, status: 'DRAFT' });
    await api(admin).post(`/quotes/${v2.id}/send`).expect(200);
    const list = (await api(admin).get(`/orders/${order.id}/quotes`).expect(200))
      .body as QuoteBody[];
    expect(list.map((item) => [item.version, item.status, item.supersededReason])).toEqual([
      [2, 'SENT', null],
      [1, 'SUPERSEDED', 'NEW_VERSION'],
    ]);
    await publicApi.get(token).expect(404);
  });

  it('lignes modifiées après acceptation : commande toujours confirmée, devis « Remplacé »', async () => {
    const { order, quote, token } = await sentQuote(67);
    await publicApi.post(`${token}/accept`, { name: 'Salma Bennani', consent: true }).expect(200);
    const confirmed = await getOrder(order.id);
    const body = orderBody(67, 'CONFIRMED');
    await api(admin)
      .put(`/orders/${order.id}`, {
        ...body,
        version: confirmed.version,
        reason: 'Ajout de 10 invités',
        lines: body.lines.map((line, index) => (index === 0 ? { ...line, quantity: 130 } : line)),
      })
      .expect(200);
    expect((await getOrder(order.id)).status).toBe('CONFIRMED');
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(row).toMatchObject({ status: 'SUPERSEDED', supersededReason: 'ORDER_CHANGED' });
    await publicApi.get(token).expect(404);
  });

  it('accord manuel (devis papier signé + scan) : orders.write, même effet, pièce jointe privée', async () => {
    const { order, quote } = await sentQuote(68);
    await api(driver)
      .multipart(`/quotes/${quote.id}/accept`)
      .field('name', 'Salma Bennani')
      .field('mode', 'PAPER')
      .expect(403);
    const invalid = await api(admin)
      .multipart(`/quotes/${quote.id}/accept`)
      .field('name', 'Salma Bennani')
      .field('mode', 'PAPER')
      .attach('file', Buffer.from('pas une image'), 'scan.png')
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'ATTACHMENT_INVALID' });

    const accepted = (
      await api(admin)
        .multipart(`/quotes/${quote.id}/accept`)
        .field('name', 'Salma Bennani')
        .field('mode', 'PAPER')
        .field('note', 'Devis signé déposé au bureau')
        .attach('file', PNG, 'scan.png')
        .expect(200)
    ).body as QuoteBody;
    expect(accepted.acceptance).toMatchObject({
      mode: 'PAPER',
      name: 'Salma Bennani',
      recordedBy: 'Karim ADMIN_TRAITEUR',
      hasAttachment: true,
      note: 'Devis signé déposé au bureau',
    });
    expect((await getOrder(order.id)).status).toBe('CONFIRMED');
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(row.acceptanceAttachmentKey).toMatch(/^private\/traiteurs\/.+\.png$/);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: quote.id, action: 'quote.accepted' },
    });
    expect(audit?.actorUserId).toBeTruthy();

    const attachment = (
      await api(admin).get(`/quotes/${quote.id}/acceptance-attachment`).expect(200)
    ).body as { url: string };
    expect((await fetch(attachment.url)).status).toBe(200);
    // PDF du devis accepté : mention de l'accord
    await api(admin).get(`/quotes/${quote.id}/pdf`).expect(200);
  });

  it('expiration : devis échu → « Expiré », commande « En attente », accord en ligne refusé', async () => {
    const { order, quote, token } = await sentQuote(69);
    // Validité dépassée (hier)
    const yesterday = new Date(`${casablancaDay(-1)}T00:00:00+01:00`);
    await prisma.quote.update({ where: { id: quote.id }, data: { validUntil: yesterday } });
    await prisma.quoteLink.updateMany({
      where: { quoteId: quote.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await app.get(QuotesService).expireDue({ traiteurId });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe(
      'EXPIRED',
    );
    expect((await getOrder(order.id)).status).toBe('PENDING');
    const view = (await publicApi.get(token).expect(200)).body as PublicQuoteBody;
    expect(view.status).toBe('EXPIRED');
    const refused = await publicApi
      .post(`${token}/accept`, { name: 'Salma Bennani', consent: true })
      .expect(400);
    expect(refused.body).toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('lien révoqué → 404 ; nouveau lien → nouveau jeton', async () => {
    const { quote, token } = await sentQuote(70);
    const revoked = (await api(admin).post(`/quotes/${quote.id}/revoke-link`).expect(200))
      .body as QuoteBody;
    expect(revoked.linkActive).toBe(false);
    await publicApi.get(token).expect(404);
    const renewed = (await api(admin).post(`/quotes/${quote.id}/link`).expect(200)).body as {
      url: string;
    };
    const fresh = renewed.url.split('/devis/')[1] ?? '';
    expect(fresh).not.toBe(token);
    await publicApi.get(fresh).expect(200);
  });

  it('isolation entre traiteurs, permissions et fonctionnalité de l’offre', async () => {
    const { order, quote } = await sentQuote(71);
    await api(otherAdmin).get(`/orders/${order.id}/quotes`).expect(404);
    await api(otherAdmin).get(`/quotes/${quote.id}/pdf`).expect(404);
    await api(driver).get(`/orders/${order.id}/quotes`).expect(403);
    await api(driver).post(`/orders/${order.id}/quotes`, {}).expect(403);

    await prisma.featureFlag.updateMany({
      where: { traiteurId, key: 'quotes' },
      data: { enabled: false },
    });
    // Cache des fonctionnalités vidé pour relire la base
    const redis = app.get<{ del: (key: string) => Promise<number> }>(REDIS_CLIENT);
    await redis.del(`feat:${traiteurId}`);
    try {
      const denied = await api(admin).get(`/orders/${order.id}/quotes`).expect(403);
      expect(denied.body).toMatchObject({ code: 'FEATURE_DISABLED' });
    } finally {
      await prisma.featureFlag.updateMany({
        where: { traiteurId, key: 'quotes' },
        data: { enabled: true },
      });
      await redis.del(`feat:${traiteurId}`);
    }
  });
});
