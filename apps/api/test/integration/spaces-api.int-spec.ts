import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { SpacesService } from '../../src/spaces/spaces.service';
import { createTestPrisma } from './helpers';

/**
 * Espaces servis selon l'adresse (domaine des tests : localhost, console : localhost) : le
 * traiteur vient du sous-domaine, une adresse inconnue ne sert rien (ni page, ni certificat).
 * Démonstration et CORS des sous-domaines : activés pour les tests dans load-env.ts.
 */
describe('Espaces selon l’adresse (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const server = (): App => app.getHttpServer() as App;
  const resolve = (host: string) =>
    request(server()).get('/api/v1/public/spaces/resolve').query({ host });

  async function createTraiteur(status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' = 'ACTIVE') {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `espace-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status,
      },
    });
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('console, sous-domaine d’un traiteur, adresse inconnue', async () => {
    const traiteur = await createTraiteur();
    await resolve('localhost:3001').expect(200, { kind: 'platform' });

    const found = await resolve(`${traiteur.slug}.localhost:3001`).expect(200);
    expect(found.body).toEqual({
      kind: 'traiteur',
      traiteur: {
        id: traiteur.id,
        slug: traiteur.slug,
        name: traiteur.name,
        logoUrl: null,
        status: 'ACTIVE',
      },
    });

    for (const host of [
      'inconnu-zz.localhost',
      'www.localhost',
      'a.b.localhost',
      'exemple.com',
      '192.168.1.8',
    ]) {
      const response = await resolve(host).expect(404);
      expect(response.body).toMatchObject({ code: 'SPACE_NOT_FOUND' });
    }
  });

  it('traiteur résilié : introuvable ; suspendu : servi (la connexion explique l’indisponibilité)', async () => {
    const cancelled = await createTraiteur('CANCELLED');
    const suspended = await createTraiteur('SUSPENDED');
    await resolve(`${cancelled.slug}.localhost`).expect(404);
    const response = await resolve(`${suspended.slug}.localhost`).expect(200);
    expect(response.body).toMatchObject({ traiteur: { status: 'SUSPENDED' } });
  });

  it('certificats HTTPS (Caddy) : seulement pour une adresse qui sert un espace', async () => {
    const traiteur = await createTraiteur();
    await request(server())
      .get('/api/v1/public/spaces/tls-check')
      .query({ domain: `${traiteur.slug}.localhost` })
      .expect(200, { allowed: true });
    for (const domain of ['inconnu-zz.localhost', 'domaine-non-verifie.ma']) {
      await request(server()).get('/api/v1/public/spaces/tls-check').query({ domain }).expect(404);
    }
  });

  it('démonstration : liste des traiteurs actifs et espace choisi', async () => {
    const traiteur = await createTraiteur();
    const cancelled = await createTraiteur('CANCELLED');
    const list = await request(server()).get('/api/v1/public/spaces/demo').expect(200);
    const slugs = (list.body as { traiteurs: { slug: string }[] }).traiteurs.map((t) => t.slug);
    expect(slugs).toContain(traiteur.slug);
    expect(slugs).not.toContain(cancelled.slug);
    await request(server())
      .get(`/api/v1/public/spaces/demo/${traiteur.slug}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ kind: 'traiteur', traiteur: { id: traiteur.id } });
      });
  });

  it('liens envoyés (invitations, devis) : adresse du traiteur', async () => {
    const traiteur = await createTraiteur();
    expect(await app.get(SpacesService).tenantUrl(traiteur.id)).toBe(
      `http://${traiteur.slug}.localhost:3001`,
    );
  });

  it('CORS : sous-domaines autorisés par modèle, jamais une autre origine', async () => {
    const allowed = await request(server())
      .options('/api/v1/public/spaces/resolve')
      .set('Origin', 'http://dar-diafa.localhost:3001')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://dar-diafa.localhost:3001');
    const refused = await request(server())
      .options('/api/v1/public/spaces/resolve')
      .set('Origin', 'http://evil.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });
});
