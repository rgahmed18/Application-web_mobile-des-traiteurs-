import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { isoWeekday } from '@traiteur/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/** Paramètres (entreprise, disponibilités, mode de prix) et Mon compte, par HTTP. */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
  phone: string;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('API des paramètres et du compte (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let passwords: PasswordService;
  let slug: string;
  let admin: Actor;
  let employee: Actor;
  let driver: Actor;
  let otherAdmin: Actor;

  async function createTraiteur() {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `reglages-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
  }

  async function actorFor(traiteurId: string, role: Role, password?: string): Promise<Actor> {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: {
        phone,
        firstName: 'Test',
        lastName: role,
        passwordHash: password ? await passwords.hash(password) : null,
      },
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
    return { token: issued.accessToken, traiteurId, membershipId: membership.id, phone };
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

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);
    passwords = app.get(PasswordService);

    const traiteur = await createTraiteur();
    slug = traiteur.slug;
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteur.id, 'EMPLOYE');
    driver = await actorFor(traiteur.id, 'LIVREUR', 'Ancien-2026');
    otherAdmin = await actorFor((await createTraiteur()).id, 'ADMIN_TRAITEUR');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('entreprise : modifiée par l’administrateur seulement, isolée par traiteur', async () => {
    const input = {
      name: 'Dar Diafa Événements',
      email: 'contact@dardiafa.ma',
      phone: '0522000000',
      city: 'Rabat',
    };
    await api(employee).get('/settings/company').expect(403);
    await api(employee).put('/settings/company', input).expect(403);
    await api(admin)
      .put('/settings/company', { ...input, email: 'pas-un-email' })
      .expect(400);
    const saved = await api(admin).put('/settings/company', input).expect(200);
    expect(saved.body).toEqual({ ...input, phone: '+212522000000' });
    const other = await api(otherAdmin).get('/settings/company').expect(200);
    expect((other.body as { name: string }).name).not.toBe(input.name);
    const audit = await prisma.auditLog.findFirst({
      where: { traiteurId: admin.traiteurId, action: 'settings.company_updated' },
    });
    expect(audit?.after).toMatchObject({ name: input.name });
  });

  it('disponibilités : un jour de fermeture hebdomadaire bloque les commandes fermes', async () => {
    await api(admin)
      .put('/settings/availability', {
        maxEventsPerDay: 3,
        closedWeekdays: [1, 2, 3, 4, 5, 6, 7],
        missionRedactionDays: 7,
      })
      .expect(400);
    await api(admin)
      .put('/settings/availability', {
        maxEventsPerDay: 3,
        closedWeekdays: [1, 1],
        missionRedactionDays: 7,
      })
      .expect(400);
    const saved = await api(admin)
      .put('/settings/availability', {
        maxEventsPerDay: 3,
        closedWeekdays: [7, 1],
        missionRedactionDays: null,
      })
      .expect(200);
    expect(saved.body).toEqual({
      maxEventsPerDay: 3,
      closedWeekdays: [1, 7],
      missionRedactionDays: null,
    });

    let offset = 40;
    while (isoWeekday(casablancaDay(offset)) !== 1) offset += 1;
    const monday = casablancaDay(offset);
    const tuesday = casablancaDay(offset + 1);
    const closed = await api(admin).get(`/orders/availability?date=${monday}`).expect(200);
    expect(closed.body).toMatchObject({ closed: true, blocked: false, full: false });
    const open = await api(admin).get(`/orders/availability?date=${tuesday}`).expect(200);
    expect(open.body).toMatchObject({ closed: false });
    const calendar = await api(admin).get(`/calendar?from=${monday}&to=${tuesday}`).expect(200);
    expect((calendar.body as { days: { closed: boolean }[] }).days.map((d) => d.closed)).toEqual([
      true,
      false,
    ]);

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
    const order = {
      clientId: (client.body as { id: string }).id,
      eventType: 'WEDDING',
      eventDate: monday,
      startTime: '20:00',
      endTime: null,
      endsNextDay: false,
      guestCount: 50,
      venueName: null,
      venueAddress: '8, avenue Hassan II',
      city: 'Casablanca',
      notes: null,
      internalNotes: null,
      status: 'CONFIRMED',
      forceAvailability: false,
      lines: [
        {
          itemType: 'CUSTOM',
          label: { fr: 'Menu' },
          quantity: 50,
          unitPrice: 20_000,
          taxRateBps: 2000,
          perPerson: true,
        },
      ],
    };
    const refused = await api(admin).post('/orders', order).expect(409);
    expect(refused.body).toMatchObject({
      code: 'AVAILABILITY_CONFLICT',
      availability: { closed: true },
    });
    await api(admin)
      .post('/orders', { ...order, forceAvailability: true })
      .expect(201);
    await api(employee)
      .put('/settings/availability', saved.body as object)
      .expect(403);
  });

  it('mode de prix : les commandes existantes gardent leur mode', async () => {
    const before = await api(admin).get('/settings/pricing').expect(200);
    expect(before.body).toMatchObject({ priceEntryMode: 'TTC', isVatRegistered: true });
    const orders = await api(admin).get('/orders?period=all').expect(200);
    const existing = (orders.body as { items: { id: string }[] }).items[0];
    await api(admin).put('/settings/pricing', { priceEntryMode: 'XX' }).expect(400);
    const saved = await api(admin).put('/settings/pricing', { priceEntryMode: 'HT' }).expect(200);
    expect(saved.body).toMatchObject({ priceEntryMode: 'HT' });
    const order = await api(admin).get(`/orders/${existing?.id}`).expect(200);
    expect((order.body as { priceMode: string }).priceMode).toBe('TTC');
    await api(admin).put('/settings/pricing', { priceEntryMode: 'TTC' }).expect(200);
  });

  it('mon compte : nom et langue ; nouveau mot de passe qui ferme toutes les sessions', async () => {
    const account = await api(driver).get('/me/account').expect(200);
    expect(account.body).toMatchObject({ phone: driver.phone, locale: 'fr', hasPassword: true });
    await api(driver)
      .put('/me/account', { firstName: 'Youssef', lastName: 'Amrani', locale: 'ar' })
      .expect(200);
    const staff = (await api(admin).get('/staff').expect(200)).body as {
      id: string;
      firstName: string;
      lastName: string;
    }[];
    expect(staff.find((member) => member.id === driver.membershipId)).toMatchObject({
      firstName: 'Youssef',
      lastName: 'Amrani',
    });

    const session = await request(server())
      .post('/api/v1/auth/login')
      .send({ traiteurSlug: slug, identifier: driver.phone, password: 'Ancien-2026' })
      .expect(200);
    const refreshToken = (session.body as { refreshToken: string }).refreshToken;

    const wrong = await api(driver)
      .post('/me/account/password', { currentPassword: 'Faux-2026', newPassword: 'Nouveau-2026' })
      .expect(400);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await api(driver)
      .post('/me/account/password', { currentPassword: 'Ancien-2026', newPassword: 'court' })
      .expect(400);
    await api(driver)
      .post('/me/account/password', {
        currentPassword: 'Ancien-2026',
        newPassword: 'Nouveau-2026',
      })
      .expect(204);

    await request(server()).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ traiteurSlug: slug, identifier: driver.phone, password: 'Nouveau-2026' })
      .expect(200);
  });
});
