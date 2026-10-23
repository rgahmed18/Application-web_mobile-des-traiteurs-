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

/**
 * Console de la plateforme : réservée au SUPER_ADMIN en session plateforme (refusée à tous les
 * autres rôles et au super admin entré chez un traiteur), chiffres agrégés seulement.
 */
interface Dashboard {
  traiteurs: { active: number; trial: number; suspended: number };
  ordersThisMonth: number;
  estimatedMonthlyRevenue: number;
  planPrices: Record<string, number>;
  trialsEndingSoon: { id: string; daysLeft: number }[];
  traiteurActivity: { id: string; ordersThisMonth: number }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Console de la plateforme (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let platformToken: string;

  const server = (): App => app.getHttpServer() as App;
  const dashboard = async (token = platformToken) =>
    (
      await request(server())
        .get('/api/v1/platform/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as Dashboard;

  async function createTraiteur(data: Record<string, unknown>) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `plateforme-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        ...data,
      },
    });
  }

  async function tokenFor(traiteurId: string | null, role: Role | 'SUPER_ADMIN') {
    const user = await prisma.user.create({
      data: {
        phone: randomPhone(),
        firstName: 'Test',
        lastName: role,
        isSuperAdmin: role === 'SUPER_ADMIN',
        // Double authentification imposée au super admin (vérifiée au rafraîchissement)
        ...(role === 'SUPER_ADMIN'
          ? { twoFactorEnabledAt: new Date(), twoFactorSecret: 'test' }
          : {}),
      },
    });
    if (role === 'SUPER_ADMIN') {
      // Chez un traiteur : entré depuis la console (accès en cours)
      const access = traiteurId
        ? await prisma.platformAccess.create({
            data: {
              userId: user.id,
              traiteurId,
              reason: 'Test',
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          })
        : null;
      return (
        await tokens.issueTokens(
          user.id,
          true,
          {
            traiteurId,
            membershipId: null,
            role: 'SUPER_ADMIN',
            platformAccessId: access?.id ?? null,
          },
          { ipAddress: '127.0.0.1', userAgent: 'jest' },
        )
      ).accessToken;
    }
    if (!traiteurId) throw new Error('traiteur requis');
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName: 'Test', lastName: role },
    });
    return (
      await tokens.issueTokens(
        user.id,
        false,
        { traiteurId, membershipId: membership.id, role },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      )
    ).accessToken;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);
    platformToken = await tokenFor(null, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('tableau de bord : statuts, abonnements estimés au prix en vigueur, essais, commandes du mois', async () => {
    const before = await dashboard();
    expect(before.planPrices).toEqual({ BASIQUE: 40_000, PRO: 85_000, PREMIUM: 150_000 });

    const premium = await createTraiteur({ status: 'ACTIVE', plan: 'PREMIUM' });
    const trial = await createTraiteur({
      status: 'TRIAL',
      plan: 'PRO',
      trialEndsAt: new Date(Date.now() + 5 * 86_400_000 - 60_000),
    });
    await createTraiteur({ status: 'SUSPENDED', plan: 'PRO' });
    // Une commande ce mois-ci chez le traiteur premium (client fictif)
    const clientUser = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Salma', lastName: 'Confidentielle' },
    });
    const client = await prisma.membership.create({
      data: {
        traiteurId: premium.id,
        userId: clientUser.id,
        role: 'CLIENT',
        firstName: 'Salma',
        lastName: 'Confidentielle',
      },
    });
    await prisma.eventType.findFirstOrThrow({ where: { traiteurId: premium.id, code: 'WEDDING' } });
    await prisma.order.create({
      data: {
        traiteurId: premium.id,
        reference: `CMD-TEST-${randomUUID().slice(0, 6)}`,
        clientId: client.id,
        eventType: 'WEDDING',
        eventDate: new Date(Date.now() + 30 * 86_400_000),
        guestCount: 100,
        venueAddress: 'Adresse',
        city: 'Casablanca',
        status: 'PENDING',
        priceMode: 'TTC',
      },
    });

    const after = await dashboard();
    expect(after.traiteurs.active - before.traiteurs.active).toBe(1);
    expect(after.traiteurs.trial - before.traiteurs.trial).toBe(1);
    expect(after.traiteurs.suspended - before.traiteurs.suspended).toBe(1);
    // Seuls les traiteurs actifs comptent dans les abonnements (pas l'essai, pas le suspendu)
    expect(after.estimatedMonthlyRevenue - before.estimatedMonthlyRevenue).toBe(150_000);
    expect(after.ordersThisMonth - before.ordersThisMonth).toBe(1);
    expect(after.trialsEndingSoon.find((row) => row.id === trial.id)?.daysLeft).toBe(5);
    // Activité par traiteur (le tableau de bord n'en montre que les 10 plus actifs)
    const listed = (
      await request(server())
        .get(`/api/v1/platform/traiteurs?search=${premium.slug}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200)
    ).body as { items: { id: string; ordersThisMonth: number }[] };
    expect(listed.items.find((row) => row.id === premium.id)?.ordersThisMonth).toBe(1);
    // Aucune donnée de client
    expect(JSON.stringify(after)).not.toContain('Confidentielle');

    // Nouveau prix en vigueur : pris en compte, l'historique est conservé
    await prisma.platformPlanPrice.create({ data: { plan: 'PREMIUM', monthlyPrice: 160_000 } });
    expect((await dashboard()).planPrices.PREMIUM).toBe(160_000);
    expect(await prisma.platformPlanPrice.count({ where: { plan: 'PREMIUM' } })).toBe(2);
    await prisma.platformPlanPrice.deleteMany({
      where: { plan: 'PREMIUM', monthlyPrice: 160_000 },
    });
  });

  it('traiteurs : création en essai, administrateur invité, liste filtrée, nouveau lien', async () => {
    const post = (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send(body);
    const slug = `essai-${randomUUID().slice(0, 8)}`;
    const adminPhone = `06${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const body = {
      slug,
      name: 'Les Délices de Fès',
      email: 'Contact@Delices.ma',
      phone: '0535000000',
      city: 'Fès',
      plan: 'PRO',
      locale: 'fr',
      trialDays: 30,
      admin: { phone: adminPhone, firstName: 'Nadia', lastName: 'Bennis' },
    };
    const created = (await post('/platform/traiteurs', body).expect(201)).body as {
      traiteur: {
        id: string;
        status: string;
        trialEndsAt: string;
        email: string;
        admin: { status: string; firstName: string; invitationExpiresAt: string };
      };
      link: { url: string };
    };
    expect(created.traiteur).toMatchObject({
      status: 'TRIAL',
      email: 'contact@delices.ma',
      admin: { status: 'INVITED', firstName: 'Nadia' },
    });
    const days = (new Date(created.traiteur.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect(created.link.url).toMatch(/\/invitation\/[A-Za-z0-9_-]{43}$/);
    const id = created.traiteur.id;
    // Offre PRO et listes par défaut (types d'événement, dont la soutenance)
    expect(
      await prisma.featureFlag.count({
        where: { traiteurId: id, key: 'staff_app', enabled: true },
      }),
    ).toBe(1);
    expect(await prisma.eventType.count({ where: { traiteurId: id, code: 'THESIS' } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { traiteurId: id, action: 'platform.traiteur_created' },
      }),
    ).toBe(1);

    // Identifiant déjà pris ; téléphone d'un super admin refusé comme administrateur
    expect((await post('/platform/traiteurs', body).expect(409)).body).toMatchObject({
      code: 'SLUG_TAKEN',
    });

    // Liste : recherche et filtre de statut
    const listed = (
      await request(server())
        .get(`/api/v1/platform/traiteurs?search=${slug}&status=TRIAL`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200)
    ).body as { items: { id: string }[]; total: number };
    expect(listed.items.map((item) => item.id)).toEqual([id]);

    // Nouveau lien : l'ancien ne vaut plus rien
    const oldToken = created.link.url.split('/invitation/')[1] ?? '';
    const resent = (await post(`/platform/traiteurs/${id}/admin-invitation`).expect(200)).body as {
      link: { url: string };
    };
    const newToken = resent.link.url.split('/invitation/')[1] ?? '';
    await request(server()).get(`/api/v1/public/invitations/${oldToken}`).expect(404);
    await request(server()).get(`/api/v1/public/invitations/${newToken}`).expect(200);
    // Administrateur activé : plus de lien à renvoyer
    await prisma.membership.updateMany({
      where: { traiteurId: id, role: 'ADMIN_TRAITEUR' },
      data: { status: 'ACTIVE' },
    });
    expect(
      (await post(`/platform/traiteurs/${id}/admin-invitation`).expect(409)).body,
    ).toMatchObject({ code: 'ADMIN_ALREADY_ACTIVE' });
  });

  it('fiche : offre, fonctionnalité coupée aussitôt, suspension et réactivation, essai, prix', async () => {
    const send = (method: 'post' | 'put', path: string, body?: object) =>
      request(server())
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send(body);
    const traiteur = await createTraiteur({
      status: 'TRIAL',
      plan: 'BASIQUE',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000),
    });
    await prisma.featureFlag.createMany({
      data: [
        { traiteurId: traiteur.id, key: 'quotes', enabled: true },
        { traiteurId: traiteur.id, key: 'invoices', enabled: true },
      ],
    });
    const adminToken = await tokenFor(traiteur.id, 'ADMIN_TRAITEUR');
    const quotesOf = () =>
      request(server())
        .get(`/api/v1/orders/${randomUUID()}/quotes`)
        .set('Authorization', `Bearer ${adminToken}`);
    await quotesOf().expect(404);

    // Offre PREMIUM avec ses fonctionnalités
    const premium = (
      await send('put', `/platform/traiteurs/${traiteur.id}/plan`, {
        plan: 'PREMIUM',
        applyPlanFeatures: true,
      }).expect(200)
    ).body as {
      plan: string;
      features: { key: string; enabled: boolean; includedInPlan: boolean }[];
    };
    expect(premium.plan).toBe('PREMIUM');
    expect(premium.features.find((item) => item.key === 'whatsapp')).toMatchObject({
      enabled: true,
      includedInPlan: true,
    });

    // Devis coupés : refusés aussitôt au traiteur (cache vidé)
    await send('put', `/platform/traiteurs/${traiteur.id}/features/quotes`, {
      enabled: false,
    }).expect(200);
    expect((await quotesOf().expect(403)).body).toMatchObject({ code: 'FEATURE_DISABLED' });
    await send('put', `/platform/traiteurs/${traiteur.id}/features/inconnue`, {
      enabled: true,
    }).expect(400);

    // Suspension : motif obligatoire, accès coupé à la requête suivante, puis réactivation
    await send('post', `/platform/traiteurs/${traiteur.id}/suspend`, { reason: '' }).expect(400);
    const suspended = (
      await send('post', `/platform/traiteurs/${traiteur.id}/suspend`, {
        reason: 'Abonnement impayé (octobre)',
      }).expect(200)
    ).body as { status: string; suspensionReason: string };
    expect(suspended).toMatchObject({
      status: 'SUSPENDED',
      suspensionReason: 'Abonnement impayé (octobre)',
    });
    expect(
      (
        await request(server())
          .get('/api/v1/orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403)
      ).body,
    ).toMatchObject({ code: 'TRAITEUR_UNAVAILABLE' });
    const reactivated = (
      await send('post', `/platform/traiteurs/${traiteur.id}/reactivate`).expect(200)
    ).body as { status: string; history: { action: string; reason: string | null }[] };
    // Essai encore en cours : il reprend
    expect(reactivated.status).toBe('TRIAL');
    expect(reactivated.history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['platform.traiteur_suspended', 'platform.traiteur_reactivated']),
    );
    expect(
      reactivated.history.find((entry) => entry.action === 'platform.traiteur_suspended')?.reason,
    ).toBe('Abonnement impayé (octobre)');
    await request(server())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Essai prolongé, puis abonnement activé avant terme
    const extended = (
      await send('put', `/platform/traiteurs/${traiteur.id}/trial`, {
        trialEndsOn: '2099-01-31',
      }).expect(200)
    ).body as { trialEndsAt: string };
    expect(extended.trialEndsAt.slice(0, 10)).toBe('2099-01-31');
    expect(
      (
        (await send('post', `/platform/traiteurs/${traiteur.id}/activate`).expect(200)).body as {
          status: string;
        }
      ).status,
    ).toBe('ACTIVE');
    await send('post', `/platform/traiteurs/${traiteur.id}/activate`).expect(400);

    // Prix d'une offre : nouveau prix en vigueur, historique conservé
    const plans = (
      await send('put', '/platform/plans/PRO/price', { monthlyPrice: 90_000 }).expect(200)
    ).body as { plans: { plan: string; monthlyPrice: number; history: unknown[] }[] };
    const pro = plans.plans.find((item) => item.plan === 'PRO');
    expect(pro?.monthlyPrice).toBe(90_000);
    expect(pro?.history.length).toBeGreaterThanOrEqual(2);
    expect((await dashboard()).planPrices.PRO).toBe(90_000);
    await prisma.platformPlanPrice.deleteMany({ where: { plan: 'PRO', monthlyPrice: 90_000 } });
  });

  it('refusée à tous les autres rôles et au super admin entré chez un traiteur', async () => {
    const traiteur = await createTraiteur({ status: 'ACTIVE' });
    const denied = [
      await tokenFor(traiteur.id, 'ADMIN_TRAITEUR'),
      await tokenFor(traiteur.id, 'EMPLOYE'),
      await tokenFor(traiteur.id, 'EQUIPE'),
      await tokenFor(traiteur.id, 'LIVREUR'),
      await tokenFor(traiteur.id, 'CLIENT'),
      await tokenFor(traiteur.id, 'SUPER_ADMIN'),
    ];
    for (const token of denied) {
      for (const call of [
        () => request(server()).get('/api/v1/platform/dashboard'),
        () => request(server()).get('/api/v1/platform/traiteurs'),
        () => request(server()).post('/api/v1/platform/traiteurs'),
        () => request(server()).post(`/api/v1/platform/traiteurs/${traiteur.id}/admin-invitation`),
        () => request(server()).get(`/api/v1/platform/traiteurs/${traiteur.id}`),
        () => request(server()).put(`/api/v1/platform/traiteurs/${traiteur.id}/plan`),
        () => request(server()).post(`/api/v1/platform/traiteurs/${traiteur.id}/suspend`),
        () => request(server()).get('/api/v1/platform/plans'),
        () => request(server()).put('/api/v1/platform/plans/PRO/price'),
        () => request(server()).post(`/api/v1/platform/traiteurs/${traiteur.id}/enter`),
        () => request(server()).get('/api/v1/platform/audit'),
        () => request(server()).get('/api/v1/platform/audit/options'),
      ]) {
        const response = await call().set('Authorization', `Bearer ${token}`).expect(403);
        expect(response.body).toMatchObject({ code: 'PLATFORM_ONLY' });
      }
    }
    await request(server()).get('/api/v1/platform/dashboard').expect(401);
    // Prolonger ou quitter : seulement pour un super admin entré chez un traiteur
    for (const token of [...denied.slice(0, 4), platformToken]) {
      for (const path of ['/api/v1/platform/access/extend', '/api/v1/platform/access/leave']) {
        const response = await request(server())
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: 'Essai' })
          .expect(403);
        expect(response.body).toMatchObject({ code: 'PLATFORM_ACCESS_REQUIRED' });
      }
    }
  });

  it('journal d’audit : filtres (qui, quoi, traiteur, période), jamais de donnée de client', async () => {
    interface AuditPage {
      items: {
        action: string;
        traiteur: { id: string; name: string } | null;
        actor: { name: string | null; role: string | null } | null;
        detail: string | null;
      }[];
      total: number;
    }
    const audit = async (query: Record<string, string>) =>
      (
        await request(server())
          .get('/api/v1/platform/audit')
          .query(query)
          .set('Authorization', `Bearer ${platformToken}`)
          .expect(200)
      ).body as AuditPage;

    const traiteur = await createTraiteur({ status: 'ACTIVE' });
    await request(server())
      .post(`/api/v1/platform/traiteurs/${traiteur.id}/enter`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'Vérification du journal' })
      .expect(200);
    // Action d'un client chez ce traiteur : son nom et le contenu ne sortent jamais
    const clientUser = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Nadia', lastName: 'Secrète' },
    });
    await prisma.auditLog.create({
      data: {
        traiteurId: traiteur.id,
        actorUserId: clientUser.id,
        actorRole: 'CLIENT',
        action: 'quote.accepted',
        entityType: 'Quote',
        after: { reason: 'Adresse : 12 rue Secrète', clientName: 'Nadia Secrète' },
      },
    });

    const platformOnly = await audit({ traiteurId: traiteur.id });
    expect(platformOnly.items.map((item) => item.action)).toEqual(['platform.access_started']);
    expect(platformOnly.items[0]).toMatchObject({
      traiteur: { id: traiteur.id, name: traiteur.name },
      actor: { role: 'SUPER_ADMIN', name: 'Test SUPER_ADMIN' },
      detail: 'Vérification du journal',
    });

    const all = await audit({ traiteurId: traiteur.id, scope: 'all' });
    expect(all.total).toBe(2);
    expect(all.items[0]).toMatchObject({
      action: 'quote.accepted',
      actor: { name: null, role: 'CLIENT' },
      detail: null,
    });
    expect(JSON.stringify(all)).not.toContain('Secrète');

    expect(
      (await audit({ traiteurId: traiteur.id, scope: 'all', action: 'quote.accepted' })).total,
    ).toBe(1);
    const access = await prisma.platformAccess.findFirstOrThrow({
      where: { traiteurId: traiteur.id },
    });
    expect(
      (await audit({ traiteurId: traiteur.id, scope: 'all', actorUserId: access.userId })).total,
    ).toBe(1);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
    expect((await audit({ traiteurId: traiteur.id, from: today, to: today })).total).toBe(1);
    expect((await audit({ traiteurId: traiteur.id, to: '2020-01-01' })).total).toBe(0);
    await request(server())
      .get('/api/v1/platform/audit')
      .query({ from: '2026-02-01', to: '2026-01-01' })
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(400);

    const options = (
      await request(server())
        .get('/api/v1/platform/audit/options')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200)
    ).body as { actors: { id: string }[]; actions: string[]; traiteurs: { id: string }[] };
    expect(options.actions).toEqual(expect.arrayContaining(['platform.access_started']));
    expect(options.traiteurs.map((row) => row.id)).toContain(traiteur.id);
    expect(options.actors.map((row) => row.id)).toContain(access.userId);
  });

  describe('entrer chez un traiteur', () => {
    interface Session {
      accessToken: string;
      refreshToken: string;
      context: { traiteurId: string | null; role: string };
    }
    interface Me {
      context: { traiteurId: string | null };
      platformAccess: {
        id: string;
        traiteurName: string;
        reason: string;
        expiresAt: string;
      } | null;
    }
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const me = async (token: string) =>
      (await request(server()).get('/api/v1/auth/me').set(auth(token)).expect(200)).body as Me;
    const enter = async (traiteurId: string, reason = 'Aide à la saisie du catalogue') =>
      (
        await request(server())
          .post(`/api/v1/platform/traiteurs/${traiteurId}/enter`)
          .set(auth(platformToken))
          .send({ reason })
          .expect(200)
      ).body as Session;
    const actions = async (traiteurId: string) =>
      (
        await prisma.auditLog.findMany({
          where: { traiteurId, action: { startsWith: 'platform.access' } },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);

    it('motif obligatoire, session limitée au traiteur, modifications tracées, sortie', async () => {
      const traiteur = await createTraiteur({ status: 'ACTIVE' });
      await request(server())
        .post(`/api/v1/platform/traiteurs/${traiteur.id}/enter`)
        .set(auth(platformToken))
        .send({ reason: ' ' })
        .expect(400);
      await request(server())
        .post(`/api/v1/platform/traiteurs/${randomUUID()}/enter`)
        .set(auth(platformToken))
        .send({ reason: 'Aide' })
        .expect(404);

      const session = await enter(traiteur.id);
      expect(session.context).toMatchObject({ traiteurId: traiteur.id, role: 'SUPER_ADMIN' });
      const inside = await me(session.accessToken);
      expect(inside.platformAccess).toMatchObject({
        traiteurName: traiteur.name,
        reason: 'Aide à la saisie du catalogue',
      });
      const remaining = Date.parse(inside.platformAccess?.expiresAt ?? '') - Date.now();
      expect(remaining).toBeGreaterThan(119 * 60_000);
      expect(remaining).toBeLessThanOrEqual(120 * 60_000);

      // Back-office du traiteur accessible ; console refusée pendant l'accès
      await request(server())
        .get('/api/v1/catalog/categories')
        .set(auth(session.accessToken))
        .expect(200);
      await request(server())
        .get('/api/v1/platform/dashboard')
        .set(auth(session.accessToken))
        .expect(403);

      // Une modification : tracée avec méthode, chemin et statut
      await request(server())
        .post('/api/v1/catalog/categories')
        .set(auth(session.accessToken))
        .send({ name: { fr: 'Ajoutée par la plateforme' }, description: null, isActive: true })
        .expect(201);
      const logged = await prisma.auditLog.findFirstOrThrow({
        where: { traiteurId: traiteur.id, action: 'platform.access_request' },
      });
      expect(logged.actorRole).toBe('SUPER_ADMIN');
      expect(logged.after).toMatchObject({
        method: 'POST',
        path: '/api/v1/catalog/categories',
        status: 201,
      });

      // Prolonger : nouveau motif, 2 heures à partir de maintenant
      await request(server())
        .post('/api/v1/platform/access/extend')
        .set(auth(session.accessToken))
        .send({})
        .expect(400);
      await request(server())
        .post('/api/v1/platform/access/extend')
        .set(auth(session.accessToken))
        .send({ reason: 'Import encore en cours' })
        .expect(200);
      const access = await prisma.platformAccess.findFirstOrThrow({
        where: { traiteurId: traiteur.id },
      });
      expect(access.extensions).toBe(1);

      // Quitter : retour à la console, sessions chez le traiteur révoquées
      const left = (
        await request(server())
          .post('/api/v1/platform/access/leave')
          .set(auth(session.accessToken))
          .expect(200)
      ).body as Session;
      expect(left.context).toMatchObject({ traiteurId: null, role: 'SUPER_ADMIN' });
      await request(server())
        .get('/api/v1/platform/dashboard')
        .set(auth(left.accessToken))
        .expect(200);
      const ended = await prisma.platformAccess.findUniqueOrThrow({ where: { id: access.id } });
      expect(ended.endReason).toBe('LEFT');
      const oldAccess = await request(server())
        .get('/api/v1/catalog/categories')
        .set(auth(session.accessToken))
        .expect(401);
      expect(oldAccess.body).toMatchObject({ code: 'PLATFORM_ACCESS_ENDED' });
      await request(server())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      expect(await actions(traiteur.id)).toEqual([
        'platform.access_started',
        'platform.access_request',
        'platform.access_extended',
        'platform.access_ended',
      ]);
    });

    it('après 2 heures : accès refusé, et le rafraîchissement ramène à la console', async () => {
      const traiteur = await createTraiteur({ status: 'ACTIVE' });
      const session = await enter(traiteur.id);
      await prisma.platformAccess.updateMany({
        where: { traiteurId: traiteur.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const refused = await request(server())
        .get('/api/v1/catalog/categories')
        .set(auth(session.accessToken))
        .expect(401);
      expect(refused.body).toMatchObject({ code: 'PLATFORM_ACCESS_ENDED' });
      await request(server())
        .post('/api/v1/platform/access/extend')
        .set(auth(session.accessToken))
        .send({ reason: 'Trop tard' })
        .expect(401);

      const refreshed = (
        await request(server())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: session.refreshToken })
          .expect(200)
      ).body as Session;
      expect(refreshed.context).toMatchObject({ traiteurId: null, role: 'SUPER_ADMIN' });
      expect((await me(refreshed.accessToken)).platformAccess).toBeNull();
      const access = await prisma.platformAccess.findFirstOrThrow({
        where: { traiteurId: traiteur.id },
      });
      expect(access.endReason).toBe('EXPIRED');
      expect(await actions(traiteur.id)).toEqual([
        'platform.access_started',
        'platform.access_ended',
      ]);
    });

    it('entrer chez un autre traiteur clôt l’accès précédent', async () => {
      const first = await createTraiteur({ status: 'ACTIVE' });
      const second = await createTraiteur({ status: 'ACTIVE' });
      const firstSession = await enter(first.id);
      await enter(second.id);
      await request(server())
        .get('/api/v1/catalog/categories')
        .set(auth(firstSession.accessToken))
        .expect(401);
      const open = await prisma.platformAccess.findMany({
        where: { traiteurId: { in: [first.id, second.id] }, endedAt: null },
      });
      expect(open.map((row) => row.traiteurId)).toEqual([second.id]);
    });
  });
});
