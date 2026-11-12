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
import { SMS_PROVIDER } from '../../src/auth/otp/sms.provider';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Cloche du back-office : nouveaux clients (à valider), demandes en ligne et leur annulation,
 * devis acceptés ou refusés par le client ; visibles selon les droits, lus par membre, jamais
 * d'un autre traiteur.
 */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}
interface Feed {
  items: { id: string; type: string; data: { clientName: string; reference: string | null } }[];
  unread: number;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const inDays = (days: number) => addDays(todayInTimeZone('Africa/Casablanca'), days);

describe('Notifications du traiteur (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  const sms: { phone: string; message: string }[] = [];
  let slug: string;
  let admin: Actor;
  let employee: Actor;
  let driver: Actor;
  let otherAdmin: Actor;
  let customer: Actor;
  let serviceId: string;

  const server = (): App => app.getHttpServer() as App;
  const ip = () => `41.255.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
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
  });
  const feed = async (actor: Actor) =>
    (await api(actor).get('/notifications').expect(200)).body as Feed;

  async function createTraiteur(requireClientApproval = false) {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `cloche-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        requireClientApproval,
      },
    });
    await prisma.featureFlag.createMany({
      data: ['invoices', 'quotes'].map((key) => ({ traiteurId: traiteur.id, key, enabled: true })),
    });
    return traiteur;
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

  const requestBody = (eventDate: string) => ({
    eventType: 'WEDDING',
    eventDate,
    startTime: '19:00',
    endTime: null,
    endsNextDay: false,
    guestCount: 50,
    venueName: null,
    venueAddress: '1 rue des Roses',
    city: 'Rabat',
    saveAddressAs: null,
    onSiteContactName: null,
    onSiteContactPhone: null,
    notes: null,
    items: [{ kind: 'service', id: serviceId, quantity: 1 }],
  });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        send: (phone: string, message: string) => {
          sms.push({ phone, message });
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteur = await createTraiteur(true);
    slug = traiteur.slug;
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteur.id, 'EMPLOYE');
    driver = await actorFor(traiteur.id, 'LIVREUR');
    customer = await actorFor(traiteur.id, 'CLIENT', 'Salma');
    otherAdmin = await actorFor((await createTraiteur()).id, 'ADMIN_TRAITEUR');
    serviceId = (
      (
        await api(admin)
          .post('/catalog/services', {
            name: { fr: 'Décoration' },
            description: null,
            price: 300_000,
            taxRateBps: null,
            pricingUnit: 'FLAT',
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

  it('nouveau client à valider : notifié aux membres qui peuvent l’accepter', async () => {
    const phone = randomPhone();
    await request(server())
      .post('/api/v1/auth/client/code')
      .set('X-Forwarded-For', ip())
      .send({ traiteurSlug: slug, phone })
      .expect(200);
    const code = /(\d{6})/.exec(
      sms.filter((item) => item.phone === phone).at(-1)?.message ?? '',
    )?.[1];
    const privacy = (
      await request(server()).get(`/api/v1/public/traiteurs/${slug}/privacy`).expect(200)
    ).body as { version: string };
    await request(server())
      .post('/api/v1/auth/client/verify')
      .set('X-Forwarded-For', ip())
      .send({
        traiteurSlug: slug,
        phone,
        code,
        signup: {
          firstName: 'Yasmine',
          lastName: 'Idrissi',
          consent: true,
          privacyVersion: privacy.version,
        },
      })
      .expect(200);

    const forAdmin = await feed(admin);
    expect(forAdmin.items[0]).toMatchObject({
      type: 'CLIENT_APPROVAL_REQUESTED',
      data: { clientName: 'Yasmine Idrissi' },
    });
    expect((await feed(employee)).items.map((item) => item.type)).toContain(
      'CLIENT_APPROVAL_REQUESTED',
    );
    // Sans droit sur les clients ni les commandes : rien ; autre traiteur : rien
    expect(await feed(driver)).toEqual({ items: [], unread: 0 });
    expect(await feed(otherAdmin)).toEqual({ items: [], unread: 0 });
    await api(customer).get('/notifications').expect(403);
  });

  it('demande en ligne, annulation, devis accepté puis refusé : chaque événement notifié', async () => {
    const first = (
      await api(customer)
        .post('/client/requests', requestBody(inDays(40)))
        .expect(201)
    ).body as { id: string; reference: string };
    await api(customer).post(`/client/requests/${first.id}/cancel`).expect(204);

    const second = (
      (
        await api(customer)
          .post('/client/requests', requestBody(inDays(41)))
          .expect(201)
      ).body as { id: string }
    ).id;
    const quote = (
      (await api(admin).post(`/orders/${second}/quotes`, {}).expect(201)).body as { id: string }
    ).id;
    await api(admin).post(`/quotes/${quote}/send`).expect(200);
    await api(customer).post(`/client/quotes/${quote}/reject`, { reason: 'Trop cher' }).expect(200);

    const third = (
      (
        await api(customer)
          .post('/client/requests', requestBody(inDays(42)))
          .expect(201)
      ).body as { id: string }
    ).id;
    const accepted = (
      (await api(admin).post(`/orders/${third}/quotes`, {}).expect(201)).body as { id: string }
    ).id;
    await api(admin).post(`/quotes/${accepted}/send`).expect(200);
    await api(customer)
      .post(`/client/quotes/${accepted}/accept`, { name: 'Salma CLIENT', consent: true })
      .expect(200);

    const types = (await feed(admin)).items.map((item) => item.type);
    expect(types.slice(0, 6)).toEqual([
      'QUOTE_ACCEPTED',
      'ORDER_REQUESTED',
      'QUOTE_REJECTED',
      'ORDER_REQUESTED',
      'ORDER_REQUEST_CANCELLED',
      'ORDER_REQUESTED',
    ]);
    const cancelled = (await feed(admin)).items.find(
      (item) => item.type === 'ORDER_REQUEST_CANCELLED',
    );
    expect(cancelled?.data).toMatchObject({
      clientName: 'Salma CLIENT',
      reference: first.reference,
    });
    expect(await feed(driver)).toEqual({ items: [], unread: 0 });
    expect((await feed(otherAdmin)).items).toEqual([]);
  });

  it('lecture propre à chaque membre : une notification lue, puis toutes', async () => {
    const before = await feed(admin);
    const employeeBefore = (await feed(employee)).unread;
    const target = before.items[0]?.id ?? '';
    const afterOne = (await api(admin).post(`/notifications/${target}/read`).expect(200))
      .body as Feed;
    expect(afterOne.unread).toBe(before.unread - 1);
    expect((await feed(employee)).unread).toBe(employeeBefore);
    // Notification d'un autre traiteur : introuvable
    await api(otherAdmin).post(`/notifications/${target}/read`).expect(404);

    const all = (await api(admin).post('/notifications/read-all').expect(200)).body as Feed;
    expect(all.unread).toBe(0);
    expect((await feed(employee)).unread).toBe(employeeBefore);
  });
});
