import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
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
 * Validation des nouveaux clients inscrits en ligne : liste « à valider », accord ou refus avec
 * motif (droit clients.approve), client prévenu, compte du client à jour, isolation des traiteurs.
 */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
  phone: string;
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Validation des nouveaux clients (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  const sms: { phone: string; message: string }[] = [];
  let admin: Actor;
  let employee: Actor;
  let driver: Actor;
  let otherAdmin: Actor;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body),
  });

  async function createTraiteur() {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `valid-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        requireClientApproval: true,
      },
    });
  }

  async function actorFor(
    traiteurId: string,
    role: Role,
    extra: { clientApproval?: 'PENDING'; privacyConsentAt?: Date } = {},
  ): Promise<Actor> {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: { phone, firstName: 'Test', lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName: 'Test', lastName: role, ...extra },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId, membershipId: membership.id, phone };
  }

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

    const traiteur = await createTraiteur();
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteur.id, 'EMPLOYE');
    driver = await actorFor(traiteur.id, 'LIVREUR');
    otherAdmin = await actorFor((await createTraiteur()).id, 'ADMIN_TRAITEUR');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('client en attente : listé « à valider », refusé avec motif, puis accepté ; prévenu à chaque fois', async () => {
    const customer = await actorFor(admin.traiteurId, 'CLIENT', {
      clientApproval: 'PENDING',
      privacyConsentAt: new Date(),
    });
    const account = await api(customer).get('/client/account').expect(200);
    expect(account.body).toMatchObject({ approval: 'PENDING', canRequest: false });

    const pending = await api(admin).get('/clients?approval=PENDING').expect(200);
    expect((pending.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
      customer.membershipId,
    ]);

    // Droits : le livreur ne décide pas ; un autre traiteur ne voit pas ce client
    await api(driver).post(`/clients/${customer.membershipId}/approve`).expect(403);
    await api(otherAdmin).post(`/clients/${customer.membershipId}/approve`).expect(404);
    // Motif obligatoire
    await api(employee)
      .post(`/clients/${customer.membershipId}/reject`, { reason: '' })
      .expect(400);

    const rejected = await api(employee)
      .post(`/clients/${customer.membershipId}/reject`, { reason: 'Zone non desservie' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      approval: 'REJECTED',
      rejectionReason: 'Zone non desservie',
    });
    expect(sms.filter((item) => item.phone === customer.phone).at(-1)?.message).toContain(
      'Zone non desservie',
    );
    expect((await api(customer).get('/client/account').expect(200)).body).toMatchObject({
      approval: 'REJECTED',
      rejectionReason: 'Zone non desservie',
      canRequest: false,
    });

    // Le traiteur revient sur sa décision
    const approved = await api(admin).post(`/clients/${customer.membershipId}/approve`).expect(200);
    expect(approved.body).toMatchObject({ approval: 'APPROVED', rejectionReason: null });
    expect(sms.filter((item) => item.phone === customer.phone).at(-1)?.message).toContain(
      'a validé votre compte',
    );
    expect((await api(customer).get('/client/account').expect(200)).body).toMatchObject({
      approval: 'APPROVED',
      canRequest: true,
    });

    const audit = await prisma.auditLog.findMany({
      where: { traiteurId: admin.traiteurId, entityId: customer.membershipId },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(audit.map((entry) => entry.action)).toEqual(['client.rejected', 'client.approved']);
  });

  it('espace client réservé aux clients ; le client n’accède pas aux fiches du traiteur', async () => {
    await api(admin).get('/client/account').expect(403);
    const customer = await actorFor(admin.traiteurId, 'CLIENT');
    await api(customer).get('/clients').expect(403);
    await api(customer).post(`/clients/${customer.membershipId}/approve`).expect(403);
  });
});
