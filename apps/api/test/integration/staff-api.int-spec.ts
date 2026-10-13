import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/** Personnel par HTTP : invitations et activation, suspension, grille des permissions. */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}

interface Member {
  id: string;
  role: string;
  status: string;
  invitation: { expiresAt: string; smsSent: boolean; expired: boolean } | null;
  isSelf: boolean;
}

interface InviteResult {
  member: Member;
  link: { url: string; expiresAt: string; smsSent: boolean };
}

interface Matrix {
  roles: string[];
  permissions: {
    key: string;
    editable: boolean;
    defaults: Record<string, boolean>;
    granted: Record<string, boolean>;
  }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const PASSWORD = 'Activation123!';

describe('API du personnel (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let otherAdmin: Actor;
  let slug: string;

  async function createTraiteur(): Promise<{ id: string; slug: string }> {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `equipe-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
      select: { id: true, slug: true },
    });
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
    return { token: issued.accessToken, traiteurId, membershipId: membership.id };
  }

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor | string) => {
    const token = typeof actor === 'string' ? actor : actor.token;
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(request(server()).delete(`/api/v1${path}`)),
    };
  };
  const publicApi = {
    get: (token: string) => request(server()).get(`/api/v1/public/invitations/${token}`),
    accept: (token: string, password: string) =>
      request(server()).post(`/api/v1/public/invitations/${token}/accept`).send({ password }),
  };
  const tokenOf = (url: string) => url.split('/invitation/')[1] ?? '';

  const invite = (role: string, phone = randomPhone(), actor: Actor = admin) =>
    api(actor).post('/staff/invitations', {
      phone,
      firstName: 'Youssef',
      lastName: 'Amrani',
      role,
      locale: 'fr',
    });

  async function login(phone: string, password: string) {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ traiteurSlug: slug, identifier: phone, password });
    return response;
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
    slug = traiteur.slug;
    admin = await actorFor(traiteur.id, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteur.id, 'EMPLOYE');
    otherAdmin = await actorFor((await createTraiteur()).id, 'ADMIN_TRAITEUR');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('invitation d’un livreur : lien affiché une fois, SMS (Maroc), activation puis connexion', async () => {
    const phone = randomPhone();
    const result = (await invite('LIVREUR', phone).expect(201)).body as InviteResult;
    expect(result.member).toMatchObject({ role: 'LIVREUR', status: 'INVITED' });
    expect(result.link.url).toMatch(/\/invitation\/[A-Za-z0-9_-]{43}$/);
    expect(result.link.smsSent).toBe(true);
    const token = tokenOf(result.link.url);
    // Seule l'empreinte du jeton est conservée
    const stored = await prisma.staffInvitation.findFirstOrThrow({
      where: { membershipId: result.member.id },
    });
    expect(stored.tokenHash).not.toContain(token);

    const view = await publicApi.get(token).expect(200);
    expect(view.headers['x-robots-tag']).toContain('noindex');
    expect(view.headers['referrer-policy']).toBe('no-referrer');
    expect(view.body).toMatchObject({ role: 'LIVREUR', hasPassword: false, firstName: 'Youssef' });

    await publicApi.accept(token, 'court').expect(400);
    const accepted = await publicApi.accept(token, PASSWORD).expect(200);
    expect(accepted.body).toMatchObject({ phone, traiteurSlug: slug });
    // Usage unique
    await publicApi.get(token).expect(404);
    await publicApi.accept(token, PASSWORD).expect(404);

    const session = await login(phone, PASSWORD);
    expect(session.status).toBe(200);
    expect((session.body as { context: { role: string } }).context.role).toBe('LIVREUR');
    const member = (await api(admin).get(`/staff/${result.member.id}`).expect(200)).body as Member;
    expect(member).toMatchObject({ status: 'ACTIVE', invitation: null });
  });

  it('numéro étranger : pas de SMS, lien à partager ; doublons refusés', async () => {
    const foreign = (await invite('EQUIPE', '+33612345678').expect(201)).body as InviteResult;
    expect(foreign.link.smsSent).toBe(false);
    const again = await invite('EQUIPE', '+33612345678').expect(409);
    expect(again.body).toMatchObject({ code: 'MEMBER_EXISTS' });

    const clientPhone = randomPhone();
    await api(admin)
      .post('/clients', {
        phone: clientPhone,
        firstName: 'Salma',
        lastName: 'Bennani',
        email: null,
        locale: 'fr',
        tags: [],
        internalNotes: null,
        address: null,
      })
      .expect(201);
    const client = await invite('LIVREUR', clientPhone).expect(409);
    expect(client.body).toMatchObject({ code: 'PHONE_IS_CLIENT' });
  });

  it('compte existant avec mot de passe : il le confirme, le lien ne le remplace jamais', async () => {
    const phone = randomPhone();
    const passwords = app.get(PasswordService);
    await prisma.user.create({
      data: {
        phone,
        firstName: 'Nadia',
        lastName: 'Idrissi',
        passwordHash: await passwords.hash('MotDePasse-Existant1'),
      },
    });
    const result = (await invite('EMPLOYE', phone).expect(201)).body as InviteResult;
    const token = tokenOf(result.link.url);
    expect((await publicApi.get(token).expect(200)).body).toMatchObject({ hasPassword: true });
    const wrong = await publicApi.accept(token, PASSWORD).expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await publicApi.accept(token, 'MotDePasse-Existant1').expect(200);
    expect((await login(phone, 'MotDePasse-Existant1')).status).toBe(200);
  });

  it('lien expiré, renouvelé ou annulé', async () => {
    const result = (await invite('EQUIPE').expect(201)).body as InviteResult;
    const first = tokenOf(result.link.url);
    await prisma.staffInvitation.updateMany({
      where: { membershipId: result.member.id },
      data: {
        createdAt: new Date(Date.now() - 9 * 86_400_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expired = await publicApi.get(first).expect(400);
    expect(expired.body).toMatchObject({ code: 'INVITATION_EXPIRED' });
    const listed = (await api(admin).get('/staff?status=INVITED').expect(200)).body as Member[];
    expect(listed.find((member) => member.id === result.member.id)?.invitation?.expired).toBe(true);

    const renewed = (await api(admin).post(`/staff/${result.member.id}/invitation`).expect(200))
      .body as InviteResult;
    const second = tokenOf(renewed.link.url);
    expect(second).not.toBe(first);
    await publicApi.get(first).expect(404);
    await publicApi.get(second).expect(200);

    await api(admin).delete(`/staff/${result.member.id}/invitation`).expect(204);
    await publicApi.get(second).expect(404);
    await api(admin).get(`/staff/${result.member.id}`).expect(404);
  });

  it('suspension : accès refusé immédiatement, sessions révoquées ; réactivation', async () => {
    const driver = await actorFor(admin.traiteurId, 'LIVREUR');
    // Membre déjà connecté auparavant : il redevient actif à la réactivation
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: driver.membershipId },
    });
    await prisma.user.update({
      where: { id: membership.userId },
      data: { lastLoginAt: new Date() },
    });
    await api(driver).get('/auth/me').expect(200);
    const suspended = (
      await api(admin)
        .post(`/staff/${driver.membershipId}/suspend`, { reason: 'Absences répétées' })
        .expect(200)
    ).body as Member;
    expect(suspended.status).toBe('SUSPENDED');
    const refused = await api(driver).get('/catalog/categories').expect(403);
    expect(refused.body).toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
    const openSessions = await prisma.refreshToken.count({
      where: { membershipId: driver.membershipId, revokedAt: null },
    });
    expect(openSessions).toBe(0);

    const reactivated = (
      await api(admin).post(`/staff/${driver.membershipId}/reactivate`).expect(200)
    ).body as { member: Member; link: unknown };
    expect(reactivated.member.status).toBe('ACTIVE');
    await api(driver).get('/catalog/categories').expect(200);
  });

  it('garde-fous : pas sur soi-même ; un administrateur est nommé ou suspendu par un administrateur', async () => {
    const self = await api(admin)
      .post(`/staff/${admin.membershipId}/suspend`, { reason: 'Test' })
      .expect(400);
    expect(self.body).toMatchObject({ code: 'CANNOT_TARGET_SELF' });

    // Un employé à qui l'on accorde la gestion du personnel ne nomme ni ne suspend d'administrateur
    await api(admin)
      .put('/settings/permissions', {
        changes: [{ role: 'EMPLOYE', key: 'staff.manage', granted: true }],
      })
      .expect(200);
    const escalation = await invite('ADMIN_TRAITEUR', randomPhone(), employee).expect(403);
    expect(escalation.body).toMatchObject({ code: 'ADMIN_REQUIRED' });
    const suspendAdmin = await api(employee)
      .post(`/staff/${admin.membershipId}/suspend`, { reason: 'Test' })
      .expect(403);
    expect(suspendAdmin.body).toMatchObject({ code: 'ADMIN_REQUIRED' });
    // …mais gère les autres rôles
    await invite('EQUIPE', randomPhone(), employee).expect(201);
    await api(admin).post('/settings/permissions/reset', { role: 'EMPLOYE' }).expect(200);

    // Changement de rôle : effet immédiat (le jeton de l'ancien rôle est refusé)
    const second = await actorFor(admin.traiteurId, 'ADMIN_TRAITEUR');
    await api(admin)
      .put(`/staff/${second.membershipId}`, {
        firstName: 'Test',
        lastName: 'Admin',
        role: 'EMPLOYE',
        locale: 'fr',
      })
      .expect(200);
    const refused = await api(second).get('/staff').expect(403);
    expect(refused.body).toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
  });

  it('grille des permissions : défauts (Équipe, Livreur), surcharges effectives, critiques verrouillées', async () => {
    const matrix = (await api(admin).get('/settings/permissions').expect(200)).body as Matrix;
    expect(matrix.roles).toEqual(['ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR']);
    const row = (key: string) => matrix.permissions.find((permission) => permission.key === key);
    // Permissions des clients hors de la grille
    expect(row('orders.read_own')).toBeUndefined();
    expect(row('payments.record')?.defaults).toMatchObject({ EMPLOYE: true, LIVREUR: false });
    const teamDefaults = matrix.permissions.filter((permission) => permission.defaults.EQUIPE);
    expect(teamDefaults.map((permission) => permission.key).sort()).toEqual([
      'assignments.read_own',
      'assignments.update_own',
    ]);
    expect(row('invoices.issue')?.editable).toBe(false);

    const critical = await api(admin)
      .put('/settings/permissions', {
        changes: [{ role: 'EMPLOYE', key: 'invoices.issue', granted: true }],
      })
      .expect(400);
    expect(critical.body).toMatchObject({ code: 'PERMISSION_NOT_EDITABLE' });

    await api(employee).get('/orders').expect(200);
    const updated = (
      await api(admin)
        .put('/settings/permissions', {
          changes: [
            { role: 'EMPLOYE', key: 'orders.read', granted: false },
            { role: 'EQUIPE', key: 'catalog.read', granted: true },
          ],
        })
        .expect(200)
    ).body as Matrix;
    const orders = updated.permissions.find((permission) => permission.key === 'orders.read');
    expect(orders?.granted.EMPLOYE).toBe(false);
    expect(orders?.defaults.EMPLOYE).toBe(true);
    await api(employee).get('/orders').expect(403);

    const team = await actorFor(admin.traiteurId, 'EQUIPE');
    await api(team).get('/catalog/categories').expect(200);
    // Les autres traiteurs gardent leurs droits
    const otherEmployee = await actorFor(otherAdmin.traiteurId, 'EMPLOYE');
    await api(otherEmployee).get('/orders').expect(200);
    const audit = await prisma.auditLog.findFirst({
      where: { traiteurId: admin.traiteurId, action: 'permissions.updated' },
    });
    expect(audit).not.toBeNull();

    await api(admin).post('/settings/permissions/reset', { role: null }).expect(200);
    await api(employee).get('/orders').expect(200);
    await api(team).get('/catalog/categories').expect(403);
    await api(employee).get('/settings/permissions').expect(403);
  });

  it('isolation entre traiteurs', async () => {
    const result = (await invite('LIVREUR').expect(201)).body as InviteResult;
    await api(otherAdmin).get(`/staff/${result.member.id}`).expect(404);
    await api(otherAdmin)
      .post(`/staff/${result.member.id}/suspend`, { reason: 'Test' })
      .expect(404);
    const list = (await api(otherAdmin).get('/staff').expect(200)).body as Member[];
    expect(list.some((member) => member.id === result.member.id)).toBe(false);
  });
});
