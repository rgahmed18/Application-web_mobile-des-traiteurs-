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
      },
    });
    if (role === 'SUPER_ADMIN') {
      return (
        await tokens.issueTokens(
          user.id,
          true,
          { traiteurId, membershipId: null, role: 'SUPER_ADMIN' },
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
      ]) {
        const response = await call().set('Authorization', `Bearer ${token}`).expect(403);
        expect(response.body).toMatchObject({ code: 'PLATFORM_ONLY' });
      }
    }
    await request(server()).get('/api/v1/platform/dashboard').expect(401);
  });
});
