import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { imageVariantPath } from '@traiteur/shared';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import { MediaService } from '../../src/catalog/media/media.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { StorageService } from '../../src/storage/storage.service';
import { createTestPrisma } from './helpers';

/**
 * Catalogue par HTTP, avec l'application complète (guards, permissions en base, Redis, stockage S3).
 * Deux traiteurs A et B : aucun ne doit voir ni modifier le catalogue de l'autre.
 */
interface Actor {
  token: string;
  traiteurId: string;
}

describe('API du catalogue (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let adminA: Actor;
  let adminB: Actor;
  let driverA: Actor;

  async function createTraiteur(priceEntryMode: 'HT' | 'TTC'): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `catalogue-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode,
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        firstName: role,
        lastName: 'Test',
      },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role },
    });
    const issued = await tokens.issueTokens(
      user.id,
      false,
      { traiteurId, membershipId: membership.id, role },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );
    return { token: issued.accessToken, traiteurId };
  }

  /** Serveur HTTP de l'application (typé pour supertest). */
  const server = (): App => app.getHttpServer() as App;

  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body),
    put: (path: string, body: object) =>
      request(server())
        .put(`/api/v1${path}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body),
    delete: (path: string) =>
      request(server()).delete(`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`),
  });

  const dishBody = (overrides: Record<string, unknown> = {}) => ({
    name: { fr: `Pastilla ${randomUUID().slice(0, 6)}`, ar: 'بسطيلة' },
    description: null,
    categoryId: null,
    price: 25_000,
    taxRateBps: null,
    unit: 'PER_PERSON',
    minQuantity: 1,
    allergens: ['gluten'],
    imageKey: null,
    isAvailable: true,
    ...overrides,
  });

  async function createDish(
    actor: Actor,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; imageKey: string | null }> {
    const response = await api(actor).post('/catalog/dishes', dishBody(overrides)).expect(201);
    return response.body as { id: string; imageKey: string | null };
  }

  /** Envoi réel d'une photo : URL pré-signée, PUT direct au stockage, traitement par l'API. */
  async function uploadPhoto(
    actor: Actor,
    body?: Buffer,
  ): Promise<{ uploadId: string; imageKey?: string; error?: string }> {
    const file =
      body ??
      (await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#b5651d' } })
        .jpeg()
        .toBuffer());
    const ticket = await api(actor)
      .post('/catalog/uploads', { contentType: 'image/jpeg', size: file.length })
      .expect(201);
    const { uploadId, uploadUrl, headers } = ticket.body as {
      uploadId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
    expect(put.status).toBe(200);
    const completed = await api(actor).post(`/catalog/uploads/${uploadId}/complete`);
    const result = completed.body as { imageKey?: string; code?: string };
    return { uploadId, imageKey: result.imageKey, error: result.code };
  }

  const publicStatus = async (key: string) =>
    (await fetch(app.get(StorageService).publicFileUrl(imageVariantPath(key, 'thumb')))).status;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteurA = await createTraiteur('TTC');
    const traiteurB = await createTraiteur('HT');
    adminA = await actorFor(traiteurA, 'ADMIN_TRAITEUR');
    driverA = await actorFor(traiteurA, 'LIVREUR');
    adminB = await actorFor(traiteurB, 'ADMIN_TRAITEUR');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('prix selon le mode de saisie du traiteur', () => {
    it('mode TTC : le TTC saisi est conservé, le HT est dérivé', async () => {
      const response = await api(adminA)
        .post('/catalog/dishes', dishBody({ price: 25_000 }))
        .expect(201);
      expect(response.body).toMatchObject({
        priceTtc: 25_000,
        priceHt: 20_833,
        effectiveTaxRateBps: 2000,
      });
    });

    it('mode HT : le HT saisi est conservé, le TTC est dérivé (taux propre au plat)', async () => {
      const response = await api(adminB)
        .post('/catalog/dishes', dishBody({ price: 10_000, taxRateBps: 1000 }))
        .expect(201);
      expect(response.body).toMatchObject({
        priceHt: 10_000,
        priceTtc: 11_000,
        effectiveTaxRateBps: 1000,
      });
    });
  });

  describe('isolation entre traiteurs', () => {
    it('B ne voit pas le catalogue de A et ne peut ni le lire, ni le modifier, ni l’archiver', async () => {
      const dish = await createDish(adminA);

      const listB = await api(adminB).get('/catalog/dishes?pageSize=100').expect(200);
      expect(
        (listB.body as { items: { id: string }[] }).items.map((item) => item.id),
      ).not.toContain(dish.id);

      expect((await api(adminB).get(`/catalog/dishes/${dish.id}`)).body).toMatchObject({
        code: 'NOT_FOUND',
      });
      await api(adminB).put(`/catalog/dishes/${dish.id}`, dishBody()).expect(404);
      await api(adminB).post(`/catalog/dishes/${dish.id}/archive`).expect(404);
      await api(adminB).delete(`/catalog/dishes/${dish.id}`).expect(404);

      const intact = await api(adminA).get(`/catalog/dishes/${dish.id}`).expect(200);
      expect((intact.body as { archivedAt: string | null }).archivedAt).toBeNull();
    });

    it('B ne peut pas composer une formule avec un plat de A, ni le classer dans sa catégorie', async () => {
      const dish = await createDish(adminA);
      await api(adminB)
        .post('/catalog/packages', {
          name: { fr: 'Formule pirate' },
          description: null,
          pricePerPerson: 10_000,
          taxRateBps: null,
          minGuests: 10,
          maxGuests: null,
          imageKey: null,
          isActive: true,
          dishes: [{ dishId: dish.id, quantity: 1 }],
        })
        .expect(404);

      const category = await api(adminA)
        .post('/catalog/categories', {
          name: { fr: 'Entrées A' },
          description: null,
          isActive: true,
        })
        .expect(201);
      await api(adminB)
        .post('/catalog/dishes', dishBody({ categoryId: (category.body as { id: string }).id }))
        .expect(404);
      await api(adminB)
        .put('/catalog/categories/order', { ids: [(category.body as { id: string }).id] })
        .expect(404);
    });

    it('B ne peut ni terminer l’envoi d’une photo de A, ni réutiliser sa photo', async () => {
      const photo = await uploadPhoto(adminA);
      expect(
        (await api(adminB).post(`/catalog/uploads/${photo.uploadId}/complete`)).body,
      ).toMatchObject({
        code: 'UPLOAD_NOT_FOUND',
      });
      const reuse = await api(adminB).post(
        '/catalog/dishes',
        dishBody({ imageKey: photo.imageKey }),
      );
      expect(reuse.body).toMatchObject({ code: 'IMAGE_INVALID' });
    });
  });

  describe('permissions', () => {
    it('le livreur consulte le catalogue mais ne peut pas le modifier', async () => {
      await api(driverA).get('/catalog/dishes').expect(200);
      const denied = await api(driverA).post('/catalog/dishes', dishBody());
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: 'MISSING_PERMISSION' });
    });

    it('refuse une requête sans jeton', async () => {
      await request(server()).get('/api/v1/catalog/dishes').expect(401);
    });
  });

  describe('archivage plutôt que suppression', () => {
    it('archive et restaure un plat ; un plat archivé n’apparaît que dans la liste des archives', async () => {
      const dish = await createDish(adminA);
      await api(adminA).post(`/catalog/dishes/${dish.id}/archive`).expect(200);
      const active = await api(adminA).get('/catalog/dishes?pageSize=100').expect(200);
      const archived = await api(adminA)
        .get('/catalog/dishes?archived=true&pageSize=100')
        .expect(200);
      const ids = (body: unknown) =>
        (body as { items: { id: string }[] }).items.map((item) => item.id);
      expect(ids(active.body)).not.toContain(dish.id);
      expect(ids(archived.body)).toContain(dish.id);
      await api(adminA).post(`/catalog/dishes/${dish.id}/restore`).expect(200);
    });

    it('refuse de supprimer un plat présent dans une formule ou utilisé dans une commande', async () => {
      const inPackage = await createDish(adminA);
      await api(adminA)
        .post('/catalog/packages', {
          name: { fr: 'Formule test' },
          description: null,
          pricePerPerson: 30_000,
          taxRateBps: null,
          minGuests: 10,
          maxGuests: 100,
          imageKey: null,
          isActive: true,
          dishes: [{ dishId: inPackage.id, quantity: 2 }],
        })
        .expect(201);
      expect((await api(adminA).delete(`/catalog/dishes/${inPackage.id}`)).body).toMatchObject({
        code: 'DISH_IN_PACKAGE',
      });

      const ordered = await createDish(adminA);
      const client = await prisma.user.create({
        data: {
          phone: `+2127${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          firstName: 'C',
          lastName: 'L',
        },
      });
      const clientMembership = await prisma.membership.create({
        data: { traiteurId: adminA.traiteurId, userId: client.id, role: 'CLIENT' },
      });
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            traiteurId: adminA.traiteurId,
            clientId: clientMembership.id,
            reference: `CMD-${randomUUID().slice(0, 8)}`,
            priceMode: 'TTC',
            eventType: 'WEDDING',
            eventDate: new Date('2026-12-01T18:00:00Z'),
            guestCount: 10,
            venueAddress: 'Salle',
            city: 'Rabat',
            totalHt: 20_833,
            totalTax: 4_167,
            totalTtc: 25_000,
          },
        });
        await tx.orderItem.create({
          data: {
            traiteurId: adminA.traiteurId,
            orderId: order.id,
            priceMode: 'TTC',
            itemType: 'DISH',
            dishId: ordered.id,
            label: 'Plat',
            quantity: 1,
            unitPriceHt: 20_833,
            unitPriceTtc: 25_000,
            taxRateBps: 2000,
            totalHt: 20_833,
            taxAmount: 4_167,
            totalTtc: 25_000,
          },
        });
      });
      expect((await api(adminA).delete(`/catalog/dishes/${ordered.id}`)).body).toMatchObject({
        code: 'ITEM_IN_USE',
      });
      expect((await api(adminA).get(`/catalog/dishes/${ordered.id}`)).body).toMatchObject({
        inUse: true,
      });
    });

    it('supprime définitivement un plat jamais utilisé', async () => {
      const dish = await createDish(adminA);
      await api(adminA).delete(`/catalog/dishes/${dish.id}`).expect(204);
      await api(adminA).get(`/catalog/dishes/${dish.id}`).expect(404);
    });
  });

  describe('journal d’audit', () => {
    it('trace chaque modification avec l’auteur, l’avant et l’après', async () => {
      const dish = await createDish(adminA);
      await api(adminA)
        .put(`/catalog/dishes/${dish.id}`, dishBody({ price: 30_000 }))
        .expect(200);
      await api(adminA).post(`/catalog/dishes/${dish.id}/archive`).expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityId: dish.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((entry) => entry.action)).toEqual([
        'catalog.dish.created',
        'catalog.dish.updated',
        'catalog.dish.archived',
      ]);
      expect(entries.every((entry) => entry.traiteurId === adminA.traiteurId)).toBe(true);
      expect(entries.every((entry) => entry.actorRole === 'ADMIN_TRAITEUR')).toBe(true);
      expect(entries[1]?.before).toMatchObject({ priceTtc: 25_000 });
      expect(entries[1]?.after).toMatchObject({ priceTtc: 30_000 });
    });
  });

  describe('photos', () => {
    it('traite une photo envoyée et la rend publique en WebP', async () => {
      const photo = await uploadPhoto(adminA);
      expect(photo.imageKey).toMatch(new RegExp(`^traiteurs/${adminA.traiteurId}/catalog/`));
      expect(await publicStatus(photo.imageKey ?? '')).toBe(200);
    });

    it('refuse un fichier qui n’est pas une image, même déclaré image/jpeg', async () => {
      const photo = await uploadPhoto(adminA, Buffer.from('<?php system($_GET["c"]); ?>'));
      expect(photo.error).toBe('IMAGE_INVALID');
    });

    it('dupliquer un plat copie sa photo : remplacer celle de l’original n’affecte pas la copie', async () => {
      const photo = await uploadPhoto(adminA);
      const original = await createDish(adminA, { imageKey: photo.imageKey });
      const duplicate = await createDish(adminA, { imageKey: photo.imageKey });
      expect(duplicate.imageKey).not.toBe(original.imageKey);
      expect(await publicStatus(duplicate.imageKey ?? '')).toBe(200);

      // Nouvelle photo pour l'original : l'ancienne est détachée…
      const replacement = await uploadPhoto(adminA);
      await api(adminA)
        .put(`/catalog/dishes/${original.id}`, dishBody({ imageKey: replacement.imageKey }))
        .expect(200);

      // …puis supprimée par le nettoyage une fois le délai de grâce écoulé
      const media = app.get(MediaService);
      await media.cleanupOrphans(new Date(Date.now() + 25 * 60 * 60 * 1000));
      expect(await publicStatus(original.imageKey ?? '')).not.toBe(200);
      expect(await publicStatus(duplicate.imageKey ?? '')).toBe(200);
      expect(await publicStatus(replacement.imageKey ?? '')).toBe(200);
    });

    it('le nettoyage supprime une photo jamais rattachée, après 24 h seulement', async () => {
      const orphan = await uploadPhoto(adminA);
      const media = app.get(MediaService);
      await media.cleanupOrphans(new Date(Date.now() + 60 * 60 * 1000));
      expect(await publicStatus(orphan.imageKey ?? '')).toBe(200);
      await media.cleanupOrphans(new Date(Date.now() + 25 * 60 * 60 * 1000));
      expect(await publicStatus(orphan.imageKey ?? '')).not.toBe(200);
      expect(await prisma.mediaUpload.count({ where: { id: orphan.uploadId } })).toBe(0);
    });
  });

  describe('catégories', () => {
    it('crée, réordonne et compte les plats actifs', async () => {
      const create = (fr: string) =>
        api(adminB)
          .post('/catalog/categories', { name: { fr }, description: null, isActive: true })
          .expect(201);
      const first = (await create('Entrées')).body as { id: string; slug: string };
      const second = (await create('Entrées')).body as { id: string; slug: string };
      expect(second.slug).toBe(`${first.slug}-2`); // identifiant unique

      const reordered = await api(adminB)
        .put('/catalog/categories/order', { ids: [second.id, first.id] })
        .expect(200);
      expect((reordered.body as { id: string }[]).slice(0, 2).map((c) => c.id)).toEqual([
        second.id,
        first.id,
      ]);
    });
  });
});
