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

/** Factures et avoirs par HTTP : acompte, solde, avoirs, annulation, numérotation, export. */
interface Actor {
  token: string;
  traiteurId: string;
}

interface InvoiceBody {
  id: string;
  type: string;
  kind: string;
  number: string;
  issuedAt: string;
  issuedOn: string;
  dueDate: string | null;
  clientName: string;
  clientIce: string | null;
  totalHt: number;
  totalTax: number;
  totalTtc: number;
  taxBreakdown: { taxRateBps: number; baseHt: number; taxAmount: number }[];
  originalNumber: string | null;
  reason: string | null;
  creditedTtc: number;
}

interface Invoicing {
  invoices: InvoiceBody[];
  available: Record<'TOTAL' | 'DEPOSIT' | 'BALANCE' | 'CANCELLATION_FEE', number | null>;
  invoicedTtc: number;
}

interface OrderBody {
  id: string;
  version: number;
  reference: string;
  totalTtc: number;
  taxBreakdown: { taxRateBps: number; baseHt: number; taxAmount: number }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('API des factures (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let otherAdmin: Actor;
  let clientId: string;
  let traiteurId: string;

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `factures-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
        legalName: 'Réceptions Test SARL',
        ice: '001234567000089',
        paymentTerms: { fr: 'Paiement par virement.', ar: 'الأداء عن طريق تحويل بنكي.' },
      },
    });
    await prisma.featureFlag.createMany({
      data: ['invoices', 'quotes'].map((key) => ({ traiteurId: traiteur.id, key, enabled: true })),
    });
    return traiteur.id;
  }

  async function actorFor(tenantId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Test', lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId: tenantId, userId: user.id, role, firstName: 'Test', lastName: role },
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
    };
  };

  /** 10 000,00 TTC : 8 000,00 à 20 % + 2 000,00 à 10 %. */
  async function createOrder(offset: number, status = 'CONFIRMED'): Promise<OrderBody> {
    const response = await api(admin)
      .post('/orders', {
        clientId,
        eventType: 'CORPORATE',
        eventDate: casablancaDay(offset),
        startTime: '12:00',
        endTime: null,
        endsNextDay: false,
        guestCount: 80,
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
            label: 'Déjeuner',
            quantity: 80,
            unitPrice: 10_000,
            taxRateBps: 2000,
            perPerson: true,
          },
          {
            itemType: 'CUSTOM',
            label: 'Transport',
            quantity: 1,
            unitPrice: 200_000,
            taxRateBps: 1000,
            perPerson: false,
          },
        ],
      })
      .expect(201);
    return response.body as OrderBody;
  }

  const invoicing = async (orderId: string) =>
    (await api(admin).get(`/orders/${orderId}/invoices`).expect(200)).body as Invoicing;
  const issue = (orderId: string, kind: string, actor: Actor = admin) =>
    api(actor).post(`/orders/${orderId}/invoices`, { kind });

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
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
    const client = await api(admin)
      .post('/clients', {
        phone: randomPhone(),
        firstName: 'Omar',
        lastName: 'Alaoui',
        email: null,
        locale: 'fr',
        tags: [],
        internalNotes: null,
        address: { label: 'Bureau', address: '20, rue Ibn Sina', city: 'Rabat', isDefault: true },
        companyName: 'Atlas Conseil SARL',
        companyIce: '002345678000012',
      })
      .expect(201);
    clientId = (client.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('acompte puis solde : une ligne par taux au prorata, acompte + solde = commande', async () => {
    const order = await createOrder(40);
    const before = await invoicing(order.id);
    expect(before.available).toEqual({
      TOTAL: 1_000_000,
      DEPOSIT: 300_000,
      BALANCE: null,
      CANCELLATION_FEE: null,
    });

    const afterDeposit = (await issue(order.id, 'DEPOSIT').expect(201)).body as Invoicing;
    const deposit = afterDeposit.invoices[0];
    expect(deposit).toMatchObject({
      type: 'INVOICE',
      kind: 'DEPOSIT',
      totalTtc: 300_000,
      clientIce: '002345678000012',
      issuedOn: casablancaDay(0),
      dueDate: casablancaDay(0),
    });
    expect(deposit?.number).toMatch(/^FAC-\d{4}-\d{5}$/);
    expect(deposit?.clientName).toBe('Atlas Conseil SARL (Omar Alaoui)');
    // Au prorata : 2 400,00 à 20 % et 600,00 à 10 %
    expect(deposit?.taxBreakdown).toEqual([
      { taxRateBps: 1000, baseHt: 54_545, taxAmount: 5_455 },
      { taxRateBps: 2000, baseHt: 200_000, taxAmount: 40_000 },
    ]);
    expect(afterDeposit.available).toMatchObject({ TOTAL: null, DEPOSIT: null, BALANCE: 700_000 });

    // PDF figé dès l'émission : empreinte et version du gabarit
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: deposit?.id ?? '' } });
    expect(row.pdfKey).toMatch(/^private\/traiteurs\/.+\/invoices\/FAC-/);
    expect(row.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.pdfTemplate).toBe('document@1');
    const download = (
      await api(admin)
        .get(`/invoices/${deposit?.id ?? ''}/pdf`)
        .expect(200)
    ).body as { url: string };
    const pdf = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const afterBalance = (await issue(order.id, 'BALANCE').expect(201)).body as Invoicing;
    const balance = afterBalance.invoices.find((invoice) => invoice.kind === 'BALANCE');
    expect(balance?.totalTtc).toBe(700_000);
    for (const entry of order.taxBreakdown) {
      const fromDeposit = deposit?.taxBreakdown.find((e) => e.taxRateBps === entry.taxRateBps);
      const fromBalance = balance?.taxBreakdown.find((e) => e.taxRateBps === entry.taxRateBps);
      expect((fromDeposit?.taxAmount ?? 0) + (fromBalance?.taxAmount ?? 0)).toBe(entry.taxAmount);
    }
    expect(afterBalance.available).toEqual({
      TOTAL: null,
      DEPOSIT: null,
      BALANCE: null,
      CANCELLATION_FEE: null,
    });
    const again = await issue(order.id, 'BALANCE').expect(400);
    expect(again.body).toMatchObject({ code: 'INVOICE_NOT_AVAILABLE' });
  });

  it('facture totale, avoir total (motif) puis nouvelle facture ; un seul avoir par facture', async () => {
    const order = await createOrder(41);
    const total = ((await issue(order.id, 'TOTAL').expect(201)).body as Invoicing).invoices[0];
    expect(total).toMatchObject({ kind: 'TOTAL', totalTtc: 1_000_000 });

    const credited = (
      await api(admin)
        .post(`/invoices/${total?.id ?? ''}/credit-note`, { reason: 'Erreur de raison sociale' })
        .expect(200)
    ).body as Invoicing;
    const credit = credited.invoices.find((invoice) => invoice.type === 'CREDIT_NOTE');
    expect(credit).toMatchObject({
      kind: 'TOTAL',
      totalTtc: -1_000_000,
      originalNumber: total?.number,
      reason: 'Erreur de raison sociale',
    });
    expect(credit?.number).toMatch(/^AV-\d{4}-\d{5}$/);
    expect(credited.invoices.find((invoice) => invoice.id === total?.id)?.creditedTtc).toBe(
      -1_000_000,
    );
    expect(credited.available.TOTAL).toBe(1_000_000);

    const twice = await api(admin)
      .post(`/invoices/${total?.id ?? ''}/credit-note`, { reason: 'Encore' })
      .expect(400);
    expect(twice.body).toMatchObject({ code: 'INVOICE_ALREADY_CREDITED' });
    await api(admin)
      .post(`/invoices/${credit?.id ?? ''}/credit-note`, { reason: 'Avoir d’avoir' })
      .expect(400);
  });

  it('numérotation partagée : l’avoir suit la série des factures (réglage)', async () => {
    await prisma.traiteur.update({
      where: { id: traiteurId },
      data: { creditNoteNumbering: 'SHARED' },
    });
    try {
      const order = await createOrder(42);
      const total = ((await issue(order.id, 'TOTAL').expect(201)).body as Invoicing).invoices[0];
      const credited = (
        await api(admin)
          .post(`/invoices/${total?.id ?? ''}/credit-note`, { reason: 'Annulation' })
          .expect(200)
      ).body as Invoicing;
      const credit = credited.invoices.find((invoice) => invoice.type === 'CREDIT_NOTE');
      const sequence = (number: string | undefined) => Number(number?.split('-')[2]);
      expect(credit?.number).toMatch(/^FAC-\d{4}-\d{5}$/);
      expect(sequence(credit?.number)).toBe(sequence(total?.number) + 1);
    } finally {
      await prisma.traiteur.update({
        where: { id: traiteurId },
        data: { creditNoteNumbering: 'SEPARATE' },
      });
    }
  });

  it('annulation avec remboursement : la facture d’acompte est soldée par un avoir du remboursé', async () => {
    const order = await createOrder(43);
    await issue(order.id, 'DEPOSIT').expect(201);
    await api(admin)
      .post(`/orders/${order.id}/payments`, {
        amount: 300_000,
        method: 'BANK_TRANSFER',
        reference: null,
        paidOn: casablancaDay(0),
        notes: null,
      })
      .expect(201);
    const current = (await api(admin).get(`/orders/${order.id}`).expect(200)).body as OrderBody;
    await api(admin)
      .post(`/orders/${order.id}/transitions`, {
        to: 'CANCELLED',
        version: current.version,
        reason: 'Événement reporté sine die',
        refund: {
          amount: 200_000,
          method: 'BANK_TRANSFER',
          reference: null,
          paidOn: casablancaDay(0),
        },
      })
      .expect(200);

    const state = await invoicing(order.id);
    const credit = state.invoices.find((invoice) => invoice.type === 'CREDIT_NOTE');
    expect(credit).toMatchObject({ kind: 'DEPOSIT', totalTtc: -200_000 });
    expect(credit?.reason).toContain('Événement reporté sine die');
    // Le reste (frais d'annulation) est déjà couvert par la facture d'acompte
    expect(state.invoicedTtc).toBe(100_000);
    expect(state.available.CANCELLATION_FEE).toBeNull();
  });

  it('frais d’annulation non facturés : facture au taux réglé dans les paramètres', async () => {
    await prisma.traiteur.update({
      where: { id: traiteurId },
      data: { cancellationFeeTaxRateBps: 1000 },
    });
    const order = await createOrder(44);
    await api(admin)
      .post(`/orders/${order.id}/payments`, {
        amount: 300_000,
        method: 'CASH',
        reference: null,
        paidOn: casablancaDay(0),
        notes: null,
      })
      .expect(201);
    const current = (await api(admin).get(`/orders/${order.id}`).expect(200)).body as OrderBody;
    await api(admin)
      .post(`/orders/${order.id}/transitions`, {
        to: 'CANCELLED',
        version: current.version,
        reason: 'Annulation client',
        refund: { amount: 100_000, method: 'CASH', reference: null, paidOn: casablancaDay(0) },
      })
      .expect(200);
    expect((await invoicing(order.id)).available.CANCELLATION_FEE).toBe(200_000);
    const fee = ((await issue(order.id, 'CANCELLATION_FEE').expect(201)).body as Invoicing)
      .invoices[0];
    expect(fee).toMatchObject({
      kind: 'CANCELLATION_FEE',
      totalTtc: 200_000,
      taxBreakdown: [{ taxRateBps: 1000, baseHt: 181_818, taxAmount: 18_182 }],
    });
  });

  it('immuable : ni modification, ni suppression, ni nouveau PDF ; date d’émission imposée', async () => {
    const order = await createOrder(45);
    const total = ((await issue(order.id, 'TOTAL').expect(201)).body as Invoicing).invoices[0];
    const id = total?.id ?? '';
    // Heure de la base (l'horloge de la machine de test peut différer)
    const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
    const dbNow = row?.now.getTime() ?? 0;
    expect(Math.abs(new Date(total?.issuedAt ?? 0).getTime() - dbNow)).toBeLessThan(60_000);
    await expect(prisma.invoice.update({ where: { id }, data: { totalTtc: 1 } })).rejects.toThrow(
      /immuable/,
    );
    await expect(
      prisma.$executeRaw`UPDATE "Invoice" SET "issuedAt" = '2020-01-01' WHERE "id" = ${id}::uuid`,
    ).rejects.toThrow(/immuable/);
    await expect(
      prisma.invoice.update({ where: { id }, data: { pdfKey: 'private/autre.pdf' } }),
    ).rejects.toThrow(/PDF émis/);
    await expect(prisma.invoice.delete({ where: { id } })).rejects.toThrow(/suppression/);
  });

  it('commande non confirmée : aucune facture ; permissions et isolation', async () => {
    const order = await createOrder(46, 'PENDING');
    expect((await invoicing(order.id)).available).toEqual({
      TOTAL: null,
      DEPOSIT: null,
      BALANCE: null,
      CANCELLATION_FEE: null,
    });
    await issue(order.id, 'TOTAL').expect(400);
    await api(employee).get(`/orders/${order.id}/invoices`).expect(403);
    await api(otherAdmin).get(`/orders/${order.id}/invoices`).expect(404);
    const confirmed = await createOrder(47);
    await issue(confirmed.id, 'TOTAL', employee).expect(403);
    await issue(confirmed.id, 'TOTAL', otherAdmin).expect(404);
  });

  it('liste et export comptable : CSV (BOM, « ; », virgule décimale) et xlsx', async () => {
    const today = casablancaDay(0);
    const page = (await api(admin).get(`/invoices?from=${today}&to=${today}`).expect(200)).body as {
      items: InvoiceBody[];
      total: number;
    };
    expect(page.total).toBeGreaterThan(5);
    const search = (await api(admin).get('/invoices?search=Atlas').expect(200)).body as {
      total: number;
    };
    expect(search.total).toBe(page.total);
    const credits = (await api(admin).get('/invoices?type=CREDIT_NOTE').expect(200)).body as {
      items: InvoiceBody[];
    };
    expect(credits.items.every((invoice) => invoice.totalTtc <= 0)).toBe(true);

    const csv = await api(admin)
      .get(`/invoices/export?format=csv&from=${today}&to=${today}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(csv.headers['content-disposition']).toContain(`factures_${today}_${today}.csv`);
    const body = csv.body as Buffer;
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = body.toString('utf8').slice(1);
    const [header, first] = text.split('\r\n');
    expect(header).toMatch(
      /^Numéro;Type;Nature;Date d'émission;Échéance;Commande;Client;ICE client/,
    );
    expect(header).toContain('Base HT 10 %;TVA 10 %;Base HT 20 %;TVA 20 %');
    expect(first).toMatch(/^FAC-\d{4}-\d{5};Facture;Acompte;\d{2}\/\d{2}\/\d{4};/);
    expect(first).toContain(';3000,00;');

    const xlsx = await api(admin)
      .get('/invoices/export?format=xlsx')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});
