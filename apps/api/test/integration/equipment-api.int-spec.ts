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
 * Matériel de fête : catalogue (catégorie, gamme, location, remplacement, stock) et
 * disponibilité par période d'occupation (installation avant, retour après l'événement).
 */
interface Actor {
  token: string;
  traiteurId: string;
}

interface Availability {
  items: {
    equipmentId: string;
    stock: number;
    reserved: number;
    pending: number;
    remaining: number;
  }[];
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('API du matériel (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let employee: Actor;
  let otherAdmin: Actor;
  let clientId: string;

  const server = (): App => app.getHttpServer() as App;
  const api = (actor: Actor) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (path: string) => auth(request(server()).get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(request(server()).post(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => auth(request(server()).put(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(request(server()).delete(`/api/v1${path}`)),
    };
  };

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `materiel-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        priceEntryMode: 'TTC',
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName: role, lastName: 'Test' },
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
    return { token: issued.accessToken, traiteurId };
  }

  const listId = async (list: string, code: string) =>
    (
      (await api(admin).get(`/catalog/lists/${list}`).expect(200)).body as {
        id: string;
        code: string;
      }[]
    ).find((item) => item.code === code)?.id ?? '';

  const equipmentBody = (overrides: Record<string, unknown> = {}) => ({
    name: { fr: `Chaise Napoléon ${randomUUID().slice(0, 6)}`, ar: 'كرسي نابليون' },
    description: null,
    categoryId: null,
    rangeId: null,
    price: 1_500,
    replacementPrice: 45_000,
    taxRateBps: null,
    stockQuantity: 200,
    imageKey: null,
    isActive: true,
    ...overrides,
  });

  /** Commande (via l'API) dont la ligne porte `quantity` unités de l'article. */
  async function orderWith(
    equipmentId: string,
    quantity: number,
    event: { date: string; start: string; end: string | null; nextDay?: boolean },
    status: 'CONFIRMED' | 'PENDING',
  ): Promise<string> {
    const order = (
      await api(admin)
        .post('/orders', {
          clientId,
          eventType: 'WEDDING',
          eventDate: event.date,
          startTime: event.start,
          endTime: event.end,
          endsNextDay: event.nextDay ?? false,
          guestCount: quantity,
          venueName: null,
          venueAddress: '8, avenue Hassan II',
          city: 'Casablanca',
          notes: null,
          internalNotes: null,
          status,
          forceAvailability: true,
          lines: [
            {
              itemType: 'CUSTOM',
              label: { fr: 'Chaises' },
              quantity,
              unitPrice: 1_500,
              taxRateBps: 2000,
              perPerson: false,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    // Les lignes de matériel arrivent avec l'étape suivante : rattachement direct en base
    await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { equipmentId } });
    return order.id;
  }

  const availability = async (start: string, end: string, excludeOrderId?: string) =>
    (
      await api(admin)
        .get(
          `/catalog/equipment/availability?start=${start}&end=${end}${
            excludeOrderId ? `&excludeOrderId=${excludeOrderId}` : ''
          }`,
        )
        .expect(200)
    ).body as Availability;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    tokens = app.get(TokenService);

    const traiteurId = await createTraiteur();
    admin = await actorFor(traiteurId, 'ADMIN_TRAITEUR');
    employee = await actorFor(traiteurId, 'EMPLOYE');
    otherAdmin = await actorFor(await createTraiteur(), 'ADMIN_TRAITEUR');
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
    clientId = (client.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('catalogue : catégories par défaut, location et remplacement en TTC, stock', async () => {
    const categories = (
      (await api(admin).get('/catalog/lists/equipment-categories').expect(200)).body as {
        code: string;
      }[]
    ).map((item) => item.code);
    expect(categories).toEqual([
      'CHAIRS',
      'TABLES',
      'LINENS',
      'COVERS',
      'TABLEWARE',
      'ACCESSORIES',
      'FLORAL',
      'LIGHTING',
    ]);

    const created = (
      await api(admin)
        .post(
          '/catalog/equipment',
          equipmentBody({
            categoryId: await listId('equipment-categories', 'CHAIRS'),
            rangeId: await listId('ranges', 'LUXE'),
          }),
        )
        .expect(201)
    ).body as {
      id: string;
      priceTtc: number;
      priceHt: number;
      replacementPriceTtc: number;
      stockQuantity: number;
      category: { code: string };
      range: { code: string };
    };
    expect(created).toMatchObject({
      priceTtc: 1_500,
      priceHt: 1_250,
      replacementPriceTtc: 45_000,
      stockQuantity: 200,
      category: { code: 'CHAIRS' },
      range: { code: 'LUXE' },
    });

    // La catégorie et la gamme portées ne se suppriment plus
    await api(admin)
      .delete(
        `/catalog/lists/equipment-categories/${await listId('equipment-categories', 'CHAIRS')}`,
      )
      .expect(409);
    await api(admin)
      .delete(`/catalog/lists/ranges/${await listId('ranges', 'LUXE')}`)
      .expect(409);

    const page = (
      await api(admin)
        .get(`/catalog/equipment?categoryId=${await listId('equipment-categories', 'CHAIRS')}`)
        .expect(200)
    ).body as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toContain(created.id);

    // Lecture pour l'employé, écriture réservée ; isolation entre traiteurs
    await api(employee).get(`/catalog/equipment/${created.id}`).expect(200);
    await api(employee).post('/catalog/equipment', equipmentBody()).expect(403);
    await api(otherAdmin).get(`/catalog/equipment/${created.id}`).expect(404);
    await api(otherAdmin)
      .post('/catalog/equipment', equipmentBody({ rangeId: await listId('ranges', 'LUXE') }))
      .expect(404);

    // Jamais utilisé : supprimable ; sur une commande : seulement archivable
    const spare = (await api(admin).post('/catalog/equipment', equipmentBody()).expect(201))
      .body as { id: string };
    await api(admin).delete(`/catalog/equipment/${spare.id}`).expect(204);
    await orderWith(
      created.id,
      10,
      { date: '2027-03-06', start: '20:00', end: '23:00' },
      'PENDING',
    );
    expect(
      (await api(admin).delete(`/catalog/equipment/${created.id}`).expect(409)).body,
    ).toMatchObject({ code: 'ITEM_IN_USE' });
    await api(admin).post(`/catalog/equipment/${created.id}/archive`).expect(200);
    await api(admin).post(`/catalog/equipment/${created.id}/restore`).expect(200);
  });

  describe('disponibilité par période (12 h avant, 24 h après par défaut)', () => {
    let chairs: string;

    beforeAll(async () => {
      chairs = (
        (
          await api(admin)
            .post('/catalog/equipment', equipmentBody({ stockQuantity: 150 }))
            .expect(201)
        ).body as { id: string }
      ).id;
    });

    const itemOf = (result: Availability) =>
      result.items.find((item) => item.equipmentId === chairs);

    it('événement après minuit : le matériel reste occupé jusqu’au retour, le surlendemain', async () => {
      // Samedi 20:30 → dimanche 03:00 : occupé de samedi 08:30 à lundi 03:00
      const order = await orderWith(
        chairs,
        100,
        { date: '2027-04-10', start: '20:30', end: '03:00', nextDay: true },
        'CONFIRMED',
      );
      expect(itemOf(await availability('2027-04-11T20:00', '2027-04-11T23:00'))).toMatchObject({
        stock: 150,
        reserved: 100,
        pending: 0,
        remaining: 50,
      });
      // Lundi 04:00 : rendu
      expect(itemOf(await availability('2027-04-12T04:00', '2027-04-12T08:00'))?.reserved).toBe(0);
      // La commande en cours de saisie ne compte pas pour elle-même
      expect(
        itemOf(await availability('2027-04-11T20:00', '2027-04-11T23:00', order))?.reserved,
      ).toBe(0);
    });

    it('chevauchement sur deux jours ; commande en attente affichée à part ; dépassement', async () => {
      // Dimanche 20:00, en attente : affichée à part, jamais déduite
      await orderWith(chairs, 60, { date: '2027-04-11', start: '20:00', end: null }, 'PENDING');
      expect(itemOf(await availability('2027-04-11T08:00', '2027-04-12T20:00'))).toMatchObject({
        reserved: 100,
        pending: 60,
        remaining: 50,
      });
      // Une autre commande ferme le même dimanche : le stock est dépassé
      await orderWith(
        chairs,
        80,
        { date: '2027-04-11', start: '13:00', end: '17:00' },
        'CONFIRMED',
      );
      expect(itemOf(await availability('2027-04-11T08:00', '2027-04-11T18:00'))).toMatchObject({
        reserved: 180,
        remaining: -30,
      });
    });

    it('deux événements le même jour sans chevauchement (délais courts de la commande)', async () => {
      const morning = await orderWith(
        chairs,
        120,
        { date: '2027-05-15', start: '09:00', end: '12:00' },
        'CONFIRMED',
      );
      await prisma.order.update({
        where: { id: morning },
        data: { equipmentSetupHours: 1, equipmentReturnHours: 1 },
      });
      // Soirée : installation à 17:00 ; le matériel du matin est rendu à 13:00
      expect(itemOf(await availability('2027-05-15T17:00', '2027-05-15T23:00'))?.reserved).toBe(0);
      expect(itemOf(await availability('2027-05-15T12:30', '2027-05-15T14:00'))?.reserved).toBe(
        120,
      );
    });

    it('commande annulée : plus comptée ; délais par défaut réglables', async () => {
      const order = await orderWith(
        chairs,
        30,
        { date: '2027-06-19', start: '20:00', end: '23:00' },
        'CONFIRMED',
      );
      expect(itemOf(await availability('2027-06-20T20:00', '2027-06-20T21:00'))?.reserved).toBe(30);
      // Retour en 6 h au lieu de 24 h : le lendemain soir est libre
      await prisma.traiteur.update({
        where: { id: admin.traiteurId },
        data: { equipmentReturnHours: 6 },
      });
      expect(itemOf(await availability('2027-06-20T20:00', '2027-06-20T21:00'))?.reserved).toBe(0);
      await prisma.order.update({ where: { id: order }, data: { status: 'CANCELLED' } });
      expect(itemOf(await availability('2027-06-19T19:00', '2027-06-19T21:00'))?.reserved).toBe(0);
    });

    it('période invalide refusée', async () => {
      await api(admin)
        .get('/catalog/equipment/availability?start=2027-06-20T21:00&end=2027-06-20T20:00')
        .expect(400);
    });
  });
});
