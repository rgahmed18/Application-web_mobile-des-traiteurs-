import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  billingSettingsVersion,
  clientEditVersion,
  companySettingsVersion,
} from '@traiteur/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Verrouillage optimiste (en-tête If-Match) du catalogue, des clients et des paramètres : un
 * enregistrement fait sur une version périmée est refusé (409 EDIT_CONFLICT), jamais écrit
 * par-dessus le travail de l'autre personne.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('Modifications simultanées (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  const server = (): App => app.getHttpServer() as App;
  const put = (path: string, body: object, version?: string) => {
    const call = request(server()).put(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return (version === undefined ? call : call.set('If-Match', `"${version}"`)).send(body);
  };
  const get = (path: string) =>
    request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).expect(200);
  const post = (path: string, body: object) =>
    request(server()).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
  const code = (response: request.Response) => (response.body as { code?: string }).code;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();

    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `conflits-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: 'Nadia', lastName: 'Gérante' },
    });
    const membership = await prisma.membership.create({
      data: {
        traiteurId: traiteur.id,
        userId: user.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'Nadia',
        lastName: 'Gérante',
      },
    });
    const issued = await app
      .get(TokenService)
      .issueTokens(
        user.id,
        false,
        { traiteurId: traiteur.id, membershipId: membership.id, role: 'ADMIN_TRAITEUR' },
        meta,
      );
    token = issued.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('plat : version périmée refusée, sans rien écraser', async () => {
    const body = {
      name: { fr: 'Pastilla', ar: 'بسطيلة' },
      description: null,
      categoryId: null,
      price: 25_000,
      taxRateBps: null,
      unit: 'PER_PERSON',
      minQuantity: 1,
      allergens: [],
      imageKey: null,
      isAvailable: true,
    };
    const created = (await post('/catalog/dishes', body).expect(201)).body as {
      id: string;
      updatedAt: string;
    };

    // Première personne : enregistre sur la version chargée
    const first = await put(
      `/catalog/dishes/${created.id}`,
      { ...body, name: { fr: 'Pastilla au poulet', ar: 'بسطيلة' } },
      created.updatedAt,
    ).expect(200);
    // Seconde personne, sur la même version (périmée) : refus
    const second = await put(
      `/catalog/dishes/${created.id}`,
      { ...body, name: { fr: 'Pastilla aux fruits de mer', ar: 'بسطيلة' } },
      created.updatedAt,
    ).expect(409);
    expect(code(second)).toBe('EDIT_CONFLICT');
    const current = (await get(`/catalog/dishes/${created.id}`)).body as {
      name: { fr: string };
      updatedAt: string;
    };
    expect(current.name.fr).toBe('Pastilla au poulet');
    expect(current.updatedAt).toBe((first.body as { updatedAt: string }).updatedAt);

    // Sur la version actuelle : accepté ; version illisible : refus ; sans version : accepté
    await put(`/catalog/dishes/${created.id}`, body, current.updatedAt).expect(200);
    expect(
      code(await put(`/catalog/dishes/${created.id}`, body, 'n-importe-quoi').expect(409)),
    ).toBe('EDIT_CONFLICT');
    await put(`/catalog/dishes/${created.id}`, body).expect(200);
  });

  it('client : version périmée refusée ; une adresse ajoutée ne bloque pas la fiche', async () => {
    const created = (
      await post('/clients', {
        phone: randomPhone(),
        firstName: 'Salma',
        lastName: 'Bennani',
        email: null,
        locale: 'fr',
        tags: [],
        internalNotes: null,
        address: null,
      }).expect(201)
    ).body as Record<string, unknown> & { id: string };
    const loaded = clientEditVersion(created);
    const fields = {
      firstName: 'Salma',
      lastName: 'Bennani',
      email: null,
      locale: 'fr',
      tags: ['VIP'],
      internalNotes: null,
      companyName: null,
      companyIce: null,
    };

    // Une adresse ajoutée entre-temps : la fiche elle-même n'a pas changé
    await post(`/clients/${created.id}/addresses`, {
      label: 'Maison',
      address: '12 rue des Orangers',
      city: 'Rabat',
      isDefault: true,
    }).expect(201);
    const saved = (await put(`/clients/${created.id}`, fields, loaded).expect(200)).body as Record<
      string,
      unknown
    >;

    const stale = await put(
      `/clients/${created.id}`,
      { ...fields, internalNotes: 'Allergie aux noix' },
      loaded,
    ).expect(409);
    expect(code(stale)).toBe('EDIT_CONFLICT');
    await put(`/clients/${created.id}`, fields, clientEditVersion(saved)).expect(200);
  });

  it('paramètres : chaque section a sa version ; une autre section ne bloque pas', async () => {
    const company = (await get('/settings/company')).body as {
      name: string;
      email: string;
      phone: string;
      city: string | null;
    };
    const billing = (await get('/settings/billing')).body as Record<string, unknown>;
    const companyVersion = companySettingsVersion(company);

    // Facturation modifiée par quelqu'un d'autre : les coordonnées restent enregistrables
    const { isVatRegistered, defaultTaxRateBps, hasLogo, ...billingInput } = billing;
    void [isVatRegistered, defaultTaxRateBps, hasLogo];
    await put(
      '/settings/billing',
      { ...billingInput, balanceDueDays: 15 },
      billingSettingsVersion(billing),
    ).expect(200);
    await put('/settings/company', { ...company, city: 'Fès' }, companyVersion).expect(200);

    // Coordonnées : la version chargée avant cet enregistrement est périmée
    const stale = await put('/settings/company', { ...company, city: 'Tanger' }, companyVersion);
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('EDIT_CONFLICT');
    expect(((await get('/settings/company')).body as { city: string }).city).toBe('Fès');
  });
});
