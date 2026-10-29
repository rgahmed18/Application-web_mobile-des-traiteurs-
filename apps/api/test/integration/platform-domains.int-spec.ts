import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { DNS_TXT_RESOLVER } from '../../src/platform/platform-domains.service';
import { SpacesService } from '../../src/spaces/spaces.service';
import { createTestPrisma } from './helpers';

/**
 * Domaines personnalisés (offre Premium) : un domaine n'est servi, et n'obtient de certificat,
 * qu'une fois vérifié par DNS TXT, actif, et si la fonctionnalité est incluse.
 */
interface Domains {
  featureEnabled: boolean;
  target: string;
  domains: {
    id: string;
    hostname: string;
    status: string;
    verification: { name: string; value: string };
    lastCheckError: string | null;
  }[];
}

describe('Domaines personnalisés (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let platformToken: string;
  /** Enregistrements TXT simulés, par nom. */
  const txt = new Map<string, string[][]>();

  const server = (): App => app.getHttpServer() as App;
  const auth = () => ({ Authorization: `Bearer ${platformToken}` });
  const tlsCheck = (domain: string) =>
    request(server()).get('/api/v1/public/spaces/tls-check').query({ domain });
  const resolve = (host: string) =>
    request(server()).get('/api/v1/public/spaces/resolve').query({ host });

  async function createTraiteur(customDomain: boolean) {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `premium-${suffix}`,
        name: `Premium ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        plan: 'PREMIUM',
      },
    });
    await prisma.featureFlag.upsert({
      where: { traiteurId_key: { traiteurId: traiteur.id, key: 'custom_domain' } },
      update: { enabled: customDomain },
      create: { traiteurId: traiteur.id, key: 'custom_domain', enabled: customDomain },
    });
    return traiteur;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DNS_TXT_RESOLVER)
      .useValue((name: string) => {
        const records = txt.get(name);
        return records ? Promise.resolve(records) : Promise.reject(new Error('ENOTFOUND'));
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    const admin = await prisma.user.create({
      data: {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: 'Super',
        lastName: 'Admin',
        isSuperAdmin: true,
      },
    });
    platformToken = (
      await app
        .get(TokenService)
        .issueTokens(
          admin.id,
          true,
          { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' },
          { ipAddress: '127.0.0.1', userAgent: 'jest' },
        )
    ).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('ajout, vérification DNS, domaine servi, certificat, liens, coupure, suppression', async () => {
    const traiteur = await createTraiteur(true);
    const hostname = `traiteur-${randomUUID().slice(0, 8)}.ma`;
    const base = `/api/v1/platform/traiteurs/${traiteur.id}/domains`;

    const added = (
      await request(server()).post(base).set(auth()).send({ hostname: hostname.toUpperCase() })
    ).body as Domains;
    expect(added.target).toBe(`${traiteur.slug}.localhost`);
    const [domain] = added.domains;
    expect(domain).toMatchObject({ hostname, status: 'PENDING' });
    expect(domain?.verification.name).toBe(`_gestion-traiteurs.${hostname}`);

    // En attente : ni servi, ni certificat
    await resolve(hostname).expect(404);
    await tlsCheck(hostname).expect(404);

    // Pas encore d'enregistrement TXT, puis une mauvaise valeur : toujours en attente
    const missing = await request(server())
      .post(`${base}/${domain?.id}/verify`)
      .set(auth())
      .expect(409);
    expect(missing.body).toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });
    txt.set(`_gestion-traiteurs.${hostname}`, [['gestion-traiteurs-verification=autre']]);
    await request(server()).post(`${base}/${domain?.id}/verify`).set(auth()).expect(409);

    // Bon enregistrement (découpé en morceaux, comme le renvoie parfois le DNS)
    const value = domain?.verification.value ?? '';
    txt.set(`_gestion-traiteurs.${hostname}`, [[value.slice(0, 20), value.slice(20)]]);
    const verified = (
      await request(server()).post(`${base}/${domain?.id}/verify`).set(auth()).expect(200)
    ).body as Domains;
    expect(verified.domains[0]).toMatchObject({ status: 'ACTIVE', lastCheckError: null });

    await tlsCheck(hostname).expect(200);
    const served = await resolve(`${hostname}:443`).expect(200);
    expect(served.body).toMatchObject({ kind: 'traiteur', traiteur: { id: traiteur.id } });
    expect(await app.get(SpacesService).tenantUrl(traiteur.id)).toBe(`https://${hostname}`);

    // Fonctionnalité coupée (changement d'offre) : plus servi, liens sur le sous-domaine
    await request(server())
      .put(`/api/v1/platform/traiteurs/${traiteur.id}/features/custom_domain`)
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    await tlsCheck(hostname).expect(404);
    expect(await app.get(SpacesService).tenantUrl(traiteur.id)).toBe(
      `http://${traiteur.slug}.localhost:3001`,
    );
    await request(server())
      .put(`/api/v1/platform/traiteurs/${traiteur.id}/features/custom_domain`)
      .set(auth())
      .send({ enabled: true })
      .expect(200);
    await tlsCheck(hostname).expect(200);

    // Coupé depuis la console : plus servi
    await request(server()).post(`${base}/${domain?.id}/disable`).set(auth()).expect(200);
    await tlsCheck(hostname).expect(404);
    await resolve(hostname).expect(404);

    await request(server()).delete(`${base}/${domain?.id}`).set(auth()).expect(200);
    expect(await prisma.traiteurDomain.count({ where: { hostname } })).toBe(0);

    const actions = (
      await prisma.auditLog.findMany({
        where: { traiteurId: traiteur.id, action: { startsWith: 'platform.domain_' } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(actions).toEqual([
      'platform.domain_added',
      'platform.domain_verified',
      'platform.domain_disabled',
      'platform.domain_removed',
    ]);
  });

  it('refusés : sans la fonctionnalité, adresse de la plateforme, IP, domaine déjà pris', async () => {
    const basic = await createTraiteur(false);
    const refused = await request(server())
      .post(`/api/v1/platform/traiteurs/${basic.id}/domains`)
      .set(auth())
      .send({ hostname: 'mon-traiteur.ma' })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'DOMAIN_FEATURE_REQUIRED' });

    const premium = await createTraiteur(true);
    const base = `/api/v1/platform/traiteurs/${premium.id}/domains`;
    for (const hostname of ['dar-diafa.localhost', 'localhost', '192.168.1.8', 'pas un domaine']) {
      const response = await request(server()).post(base).set(auth()).send({ hostname });
      expect(response.status).toBe(400);
    }
    const hostname = `pris-${randomUUID().slice(0, 8)}.ma`;
    await request(server()).post(base).set(auth()).send({ hostname }).expect(200);
    const other = await createTraiteur(true);
    const taken = await request(server())
      .post(`/api/v1/platform/traiteurs/${other.id}/domains`)
      .set(auth())
      .send({ hostname })
      .expect(409);
    expect(taken.body).toMatchObject({ code: 'DOMAIN_TAKEN' });
  });

  it('réservé à la console : refusé à un administrateur de traiteur', async () => {
    const traiteur = await createTraiteur(true);
    const user = await prisma.user.create({
      data: {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: 'Admin',
        lastName: 'Traiteur',
      },
    });
    const membership = await prisma.membership.create({
      data: {
        traiteurId: traiteur.id,
        userId: user.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'Admin',
        lastName: 'Traiteur',
      },
    });
    const token = (
      await app
        .get(TokenService)
        .issueTokens(
          user.id,
          false,
          { traiteurId: traiteur.id, membershipId: membership.id, role: 'ADMIN_TRAITEUR' },
          { ipAddress: '127.0.0.1', userAgent: 'jest' },
        )
    ).accessToken;
    const response = await request(server())
      .post(`/api/v1/platform/traiteurs/${traiteur.id}/domains`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hostname: 'mon-domaine.ma' })
      .expect(403);
    expect(response.body).toMatchObject({ code: 'PLATFORM_ONLY' });
  });
});
