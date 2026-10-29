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
import { DraftsService } from '../../src/drafts/drafts.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Brouillons côté serveur : limités à l'utilisateur ET au traiteur, jamais de champ sensible,
 * invisibles pour les autres (super admin compris), supprimés à la fin de l'accès du super
 * admin et au bout de 30 jours.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const client = { ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('Brouillons (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;

  const server = (): App => app.getHttpServer() as App;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const save = (token: string, formKey: string, data: Record<string, unknown>, label = 'Test') =>
    request(server())
      .put(`/api/v1/me/drafts/${formKey}`)
      .set(auth(token))
      .send({ label, baseVersion: '3', data });
  const list = async (token: string) =>
    (
      (await request(server()).get('/api/v1/me/drafts').set(auth(token)).expect(200)).body as {
        drafts: { formKey: string }[];
      }
    ).drafts.map((draft) => draft.formKey);

  async function createTraiteur() {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `brouillon-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
  }

  async function memberToken(traiteurId: string, role: Role, userId?: string) {
    const user =
      userId ??
      (
        await prisma.user.create({
          data: { phone: randomPhone(), firstName: 'Samir', lastName: role },
        })
      ).id;
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user, role, firstName: 'Samir', lastName: role },
    });
    const issued = await tokens.issueTokens(
      user,
      false,
      { traiteurId, membershipId: membership.id, role },
      client,
    );
    return { token: issued.accessToken, userId: user };
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('enregistrer, lister, relire, remplacer, supprimer ; jamais de champ sensible', async () => {
    const traiteur = await createTraiteur();
    const { token } = await memberToken(traiteur.id, 'EMPLOYE');

    await save(token, 'order:new', {
      eventDate: '2026-12-20',
      guestCount: 120,
      password: 'Secret2026',
      code: '123456',
      client: { firstName: 'Salma', recoveryCode: 'ABCD-EFGH' },
    }).expect(200);
    expect(await list(token)).toEqual(['order:new']);

    const draft = (await request(server()).get('/api/v1/me/drafts/order:new').set(auth(token)))
      .body as { data: Record<string, unknown>; baseVersion: string; label: string };
    expect(draft).toMatchObject({ baseVersion: '3', label: 'Test' });
    expect(draft.data).toEqual({
      eventDate: '2026-12-20',
      guestCount: 120,
      client: { firstName: 'Salma' },
    });
    const stored = await prisma.formDraft.findFirstOrThrow({ where: { formKey: 'order:new' } });
    expect(JSON.stringify(stored.data)).not.toMatch(/Secret2026|123456|ABCD-EFGH/);

    await save(token, 'order:new', { guestCount: 150 }).expect(200);
    expect(await prisma.formDraft.count({ where: { traiteurId: traiteur.id } })).toBe(1);

    await request(server()).delete('/api/v1/me/drafts/order:new').set(auth(token)).expect(204);
    expect(await list(token)).toEqual([]);
    await request(server()).get('/api/v1/me/drafts/order:new').set(auth(token)).expect(404);
  });

  it('isolation : autre utilisateur, autre traiteur pour le même compte, client refusé', async () => {
    const darDiafa = await createTraiteur();
    const saveurs = await createTraiteur();
    const owner = await memberToken(darDiafa.id, 'ADMIN_TRAITEUR');
    const colleague = await memberToken(darDiafa.id, 'ADMIN_TRAITEUR');
    // Le même compte, aussi membre du personnel d'un autre traiteur
    const sameUserElsewhere = await memberToken(saveurs.id, 'EMPLOYE', owner.userId);
    const customer = await memberToken(darDiafa.id, 'CLIENT');

    await save(owner.token, 'settings:company', { legalName: 'Dar Diafa SARL' }).expect(200);
    expect(await list(colleague.token)).toEqual([]);
    await request(server())
      .get('/api/v1/me/drafts/settings:company')
      .set(auth(colleague.token))
      .expect(404);
    expect(await list(sameUserElsewhere.token)).toEqual([]);
    // Supprimer « le même » brouillon ailleurs ne touche pas celui-ci
    await request(server())
      .delete('/api/v1/me/drafts/settings:company')
      .set(auth(colleague.token))
      .expect(204);
    expect(await list(owner.token)).toEqual(['settings:company']);

    await request(server()).get('/api/v1/me/drafts').set(auth(customer.token)).expect(403);
  });

  it('refusés : formulaire inconnu, brouillon trop volumineux', async () => {
    const traiteur = await createTraiteur();
    const { token } = await memberToken(traiteur.id, 'EMPLOYE');
    await save(token, 'account:new', { a: 1 }).expect(400);
    await save(token, 'order:pas-un-identifiant', { a: 1 }).expect(400);
    const tooLarge = await save(token, 'dish:new', { notes: 'x'.repeat(95_000) }).expect(400);
    expect(tooLarge.body).toMatchObject({ code: 'DRAFT_TOO_LARGE' });
    // Au-delà de la limite des requêtes de l'API : refusé avant même d'être lu
    await save(token, 'dish:new', { notes: 'x'.repeat(150_000) }).expect(413);
  });

  it('super admin : brouillons seulement pendant un accès, invisibles des autres, supprimés à sa fin', async () => {
    const traiteur = await createTraiteur();
    const staff = await memberToken(traiteur.id, 'ADMIN_TRAITEUR');
    const admin = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Super', lastName: 'Admin', isSuperAdmin: true },
    });
    const platform = await tokens.issueTokens(
      admin.id,
      true,
      { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' },
      client,
    );
    // Console : pas de brouillons
    await request(server()).get('/api/v1/me/drafts').set(auth(platform.accessToken)).expect(403);

    const access = await prisma.platformAccess.create({
      data: {
        userId: admin.id,
        traiteurId: traiteur.id,
        reason: 'Aide à la saisie',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const inside = await tokens.issueTokens(
      admin.id,
      true,
      {
        traiteurId: traiteur.id,
        membershipId: null,
        role: 'SUPER_ADMIN',
        platformAccessId: access.id,
      },
      client,
    );
    await save(inside.accessToken, 'dish:new', { name: { fr: 'Pastilla' } }).expect(200);
    expect(await list(inside.accessToken)).toEqual(['dish:new']);
    expect(await list(staff.token)).toEqual([]);
    // Aucune ligne d'audit pour l'enregistrement d'un brouillon (ni son contenu)
    expect(
      await prisma.auditLog.count({
        where: { traiteurId: traiteur.id, action: 'platform.access_request' },
      }),
    ).toBe(0);

    await request(server())
      .post('/api/v1/platform/access/leave')
      .set(auth(inside.accessToken))
      .expect(200);
    expect(await prisma.formDraft.count({ where: { platformAccessId: access.id } })).toBe(0);
  });

  it('purge : brouillons de plus de 30 jours et d’un accès terminé', async () => {
    const traiteur = await createTraiteur();
    const { token, userId } = await memberToken(traiteur.id, 'EMPLOYE');
    await save(token, 'client:new', { firstName: 'Omar' }).expect(200);
    await save(token, 'dish:new', { name: { fr: 'Tajine' } }).expect(200);
    await prisma.formDraft.updateMany({
      where: { userId, formKey: 'client:new' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Expiré : déjà invisible avant la purge
    expect(await list(token)).toEqual(['dish:new']);

    await app.get(DraftsService).purge();
    expect(
      (await prisma.formDraft.findMany({ where: { userId } })).map((row) => row.formKey),
    ).toEqual(['dish:new']);
  });
});
