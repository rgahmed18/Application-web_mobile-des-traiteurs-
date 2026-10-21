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

/** Affectations et missions par HTTP : un livreur ne voit que ses missions, jamais de prix. */
interface Actor {
  token: string;
  traiteurId: string;
  membershipId: string;
}

interface Staffing {
  assignments: {
    id: string;
    status: string;
    staffRole: string;
    member: { id: string };
    conflicts: { orderReference: string }[];
  }[];
  serviceInfo: Record<string, string | null>;
  alert: string | null;
}

interface MissionBody {
  id: string;
  orderReference: string;
  status: string;
  place: string;
  redacted: boolean;
  venue: { address: string; mapsUrl: string } | null;
  contact: { name: string; phone: string } | null;
  content: { label: { fr: string }; quantity: number }[];
  team: { firstName: string; phone: string | null; isSelf: boolean }[];
  deliverySteps: string[];
  canConfirm: boolean;
  canDecline: boolean;
  documents: { deliveryNote: boolean; preparationSheet: boolean };
}

const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const casablancaDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

/** Aucune clé monétaire, à aucun niveau de la réponse. */
function moneyKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => moneyKeys(item, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(/price|total|amount|paid|deposit|ttc|^ht$|tax|remaining|internal/i.test(key)
      ? [`${path}.${key}`]
      : []),
    ...moneyKeys(child, `${path}.${key}`),
  ]);
}

describe('API des affectations et missions (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let admin: Actor;
  let driver: Actor;
  let otherDriver: Actor;
  let cook: Actor;
  let otherAdmin: Actor;
  let clientId: string;

  async function createTraiteur(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `missions-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
    return traiteur.id;
  }

  async function actorFor(traiteurId: string, role: Role, firstName = 'Test'): Promise<Actor> {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), firstName, lastName: role },
    });
    const membership = await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName, lastName: role },
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

  async function createOrder(offset: number, status = 'CONFIRMED') {
    const response = await api(admin)
      .post('/orders', {
        clientId,
        eventType: 'WEDDING',
        eventDate: casablancaDay(offset),
        startTime: '20:00',
        endTime: '23:30',
        endsNextDay: false,
        guestCount: 120,
        venueName: 'Salle Les Jasmins',
        venueAddress: '8, avenue Hassan II',
        city: 'Casablanca',
        notes: 'Table d’honneur pour 10',
        internalNotes: 'Client difficile sur les délais',
        status,
        forceAvailability: true,
        lines: [
          {
            itemType: 'CUSTOM',
            label: { fr: 'Menu mariage', ar: 'قائمة العرس' },
            quantity: 120,
            unitPrice: 25_000,
            taxRateBps: 2000,
            perPerson: true,
          },
        ],
      })
      .expect(201);
    return response.body as { id: string; reference: string; version: number };
  }

  const assign = (
    orderId: string,
    member: Actor,
    staffRole: string,
    startsAt: string,
    endsAt: string,
    force = false,
  ) =>
    api(admin).post(`/orders/${orderId}/assignments`, {
      membershipId: member.membershipId,
      staffRole,
      startsAt,
      endsAt,
      notes: 'Arriver par l’entrée de service',
      force,
    });

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
    driver = await actorFor(traiteurId, 'LIVREUR', 'Youssef');
    otherDriver = await actorFor(traiteurId, 'LIVREUR', 'Hamid');
    cook = await actorFor(traiteurId, 'EQUIPE', 'Fatima');
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

  it('affectation : commande confirmée seulement, pas de doublon ; chevauchement refusé puis forcé', async () => {
    const day = casablancaDay(30);
    const pending = await createOrder(29, 'PENDING');
    const notFirm = await assign(
      pending.id,
      driver,
      'DRIVER',
      `${day}T17:00`,
      `${day}T19:00`,
    ).expect(400);
    expect(notFirm.body).toMatchObject({ code: 'ORDER_NOT_FIRM' });

    const order = await createOrder(30);
    await assign(order.id, driver, 'DRIVER', `${day}T17:00`, `${day}T20:30`).expect(201);
    const duplicate = await assign(
      order.id,
      driver,
      'DRIVER',
      `${day}T17:00`,
      `${day}T20:30`,
    ).expect(409);
    expect(duplicate.body).toMatchObject({ code: 'ASSIGNMENT_EXISTS' });
    await assign(order.id, driver, 'DRIVER', `${day}T20:00`, `${day}T17:00`).expect(400);

    const second = await createOrder(30);
    const overlap = await assign(
      second.id,
      driver,
      'DRIVER',
      `${day}T19:00`,
      `${day}T22:00`,
    ).expect(409);
    expect(overlap.body).toMatchObject({
      code: 'ASSIGNMENT_CONFLICT',
      conflicts: [expect.objectContaining({ orderReference: order.reference })],
    });
    const forced = (
      await assign(second.id, driver, 'DRIVER', `${day}T19:00`, `${day}T22:00`, true).expect(201)
    ).body as Staffing;
    expect(forced.assignments[0]?.conflicts.map((item) => item.orderReference)).toEqual([
      order.reference,
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: {
        traiteurId: admin.traiteurId,
        action: 'assignment.created',
        entityId: forced.assignments[0]?.id,
      },
    });
    expect(audit?.after).toMatchObject({ overlapForced: true });

    const planning = (await api(admin).get(`/assignments/planning?week=${day}`).expect(200))
      .body as {
      members: { id: string; missions: { conflict: boolean }[] }[];
    };
    const row = planning.members.find((member) => member.id === driver.membershipId);
    expect(row?.missions).toHaveLength(2);
    expect(row?.missions.every((mission) => mission.conflict)).toBe(true);
  });

  it('affectation par lot : une transaction, problème par ligne, chevauchement levé ligne par ligne', async () => {
    const day = casablancaDay(40);
    const busy = await createOrder(40);
    await assign(busy.id, otherDriver, 'DRIVER', `${day}T15:00`, `${day}T18:00`).expect(201);
    const order = await createOrder(40);
    const line = (
      member: Actor,
      staffRole: string,
      startsAt: string,
      endsAt: string,
      extra: Record<string, unknown> = {},
    ) => ({ membershipId: member.membershipId, staffRole, startsAt, endsAt, ...extra });
    const batch = (lines: object[]) =>
      api(admin).post(`/orders/${order.id}/assignments/batch`, { lines });

    // Même membre, même rôle, deux fois dans le lot : refusé dès la validation
    await batch([
      line(cook, 'COOK', `${day}T14:00`, `${day}T23:00`),
      line(cook, 'COOK', `${day}T14:00`, `${day}T23:00`),
    ]).expect(400);

    const lines = [
      line(cook, 'COOK', `${day}T14:00`, `${day}T23:00`),
      // Même membre, autre rôle, horaires qui chevauchent la ligne 0
      line(cook, 'WAITER', `${day}T20:00`, `${day}T23:30`),
      // Mission déjà enregistrée sur une autre commande
      line(otherDriver, 'DRIVER', `${day}T17:00`, `${day}T19:30`),
      // Encaissement réservé au chauffeur ou au superviseur
      line(driver, 'COOK', `${day}T14:00`, `${day}T18:00`, {
        cashToCollect: 100_000,
        cashMethod: 'CASH',
      }),
    ];
    const rejected = await batch(lines).expect(409);
    expect(rejected.body).toMatchObject({
      code: 'ASSIGNMENT_BATCH_CONFLICT',
      problems: [
        { index: 0, code: 'OVERLAP', conflicts: [], lines: [1] },
        { index: 1, code: 'OVERLAP', conflicts: [], lines: [0] },
        {
          index: 2,
          code: 'OVERLAP',
          conflicts: [expect.objectContaining({ orderReference: busy.reference })],
          lines: [],
        },
        { index: 3, code: 'CASH_NOT_ALLOWED' },
      ],
    });
    // Rien n'est enregistré tant qu'une ligne pose problème
    expect(await prisma.staffAssignment.count({ where: { orderId: order.id } })).toBe(0);

    // Chevauchements levés ligne par ligne, ligne 3 corrigée (chauffeur)
    const accepted = lines.map((item, index) => (index < 3 ? { ...item, force: true } : item));
    accepted[3] = line(driver, 'DRIVER', `${day}T14:00`, `${day}T18:00`, {
      cashToCollect: 100_000,
      cashMethod: 'CASH',
    });
    const staffing = (await batch(accepted).expect(201)).body as Staffing;
    expect(staffing.assignments).toHaveLength(4);
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'assignment.created',
        entityId: { in: staffing.assignments.map((assignment) => assignment.id) },
      },
    });
    expect(audits).toHaveLength(4);
    expect(
      audits.filter((entry) => (entry.after as { overlapForced: boolean }).overlapForced),
    ).toHaveLength(3);

    // Rôle déjà tenu sur l'événement : à corriger, pas de « passer outre »
    const again = await batch([
      line(cook, 'COOK', `${day}T14:00`, `${day}T23:00`, { force: true }),
    ]).expect(409);
    expect(again.body).toMatchObject({
      problems: [{ index: 0, code: 'ASSIGNMENT_EXISTS' }],
    });

    // Réservé à staff.manage
    await api(driver)
      .post(`/orders/${order.id}/assignments/batch`, {
        lines: [line(driver, 'DRIVER', `${day}T10:00`, `${day}T11:00`)],
      })
      .expect(403);
  });

  it('le livreur ne voit que ses missions, sans prix ni note interne ; jamais les commandes', async () => {
    const day = casablancaDay(31);
    const order = await createOrder(31);
    await assign(order.id, driver, 'DRIVER', `${day}T17:00`, `${day}T20:30`).expect(201);
    const staffing = (
      await assign(order.id, cook, 'COOK', `${day}T10:00`, `${day}T21:00`).expect(201)
    ).body as Staffing;
    await api(admin)
      .put(`/orders/${order.id}/service-info`, {
        onSiteContactName: 'Karim (beau-frère)',
        onSiteContactPhone: '0661234567',
        serviceNotes: 'Monter par l’ascenseur de service',
      })
      .expect(200);

    const list = (await api(driver).get('/me/missions').expect(200)).body as MissionBody[];
    expect(list.every((mission) => mission.orderReference !== undefined)).toBe(true);
    const own = list.find((mission) => mission.orderReference === order.reference);
    expect(own).toBeDefined();

    const detail = await api(driver)
      .get(`/me/missions/${own?.id ?? ''}`)
      .expect(200);
    expect(moneyKeys(detail.body)).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toContain('Client difficile');
    const mission = detail.body as MissionBody;
    expect(mission).toMatchObject({
      status: 'ASSIGNED',
      canConfirm: true,
      contact: { name: 'Karim (beau-frère)', phone: '+212661234567' },
      documents: { deliveryNote: true, preparationSheet: false },
    });
    expect(mission.venue?.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
    expect(mission.content).toEqual([
      expect.objectContaining({ label: { fr: 'Menu mariage', ar: 'قائمة العرس' }, quantity: 120 }),
    ]);
    expect(mission.team.map((member) => [member.firstName, member.isSelf])).toEqual([
      ['Fatima', false],
      ['Youssef', true],
    ]);

    // Mission d'un autre : inexistante pour lui ; commandes : interdites
    const cookMission = staffing.assignments.find((item) => item.staffRole === 'COOK');
    await api(driver)
      .get(`/me/missions/${cookMission?.id ?? ''}`)
      .expect(404);
    await api(otherDriver)
      .get(`/me/missions/${own?.id ?? ''}`)
      .expect(404);
    await api(driver).get('/orders').expect(403);
    // Catalogue (prix) : refusé au livreur par défaut
    await api(driver).get('/catalog/dishes').expect(403);
    await api(driver).get(`/orders/${order.id}`).expect(403);
    await api(cook).get('/orders').expect(403);
    await api(cook).get(`/orders/${order.id}/payments`).expect(403);
    // Isolation entre traiteurs
    await api(otherAdmin).get(`/orders/${order.id}/staffing`).expect(404);
  });

  it('confirmation, refus (alerte tableau de bord et commande), non confirmé à 48 h', async () => {
    const day = casablancaDay(32);
    const order = await createOrder(32);
    const staffing = (
      await assign(order.id, cook, 'WAITER', `${day}T18:00`, `${day}T23:59`).expect(201)
    ).body as Staffing;
    const missionId = staffing.assignments[0]?.id ?? '';
    await api(cook).post(`/me/missions/${missionId}/confirm`).expect(200);
    await api(cook).post(`/me/missions/${missionId}/confirm`).expect(400);

    const before = (await api(admin).get('/dashboard').expect(200)).body as {
      staffAlerts: { declined: number };
    };
    const declined = (
      await api(cook).post(`/me/missions/${missionId}/decline`, { reason: 'Malade' }).expect(200)
    ).body as MissionBody;
    expect(declined.status).toBe('DECLINED');
    const after = (await api(admin).get('/dashboard').expect(200)).body as {
      staffAlerts: { declined: number };
    };
    expect(after.staffAlerts.declined).toBe(before.staffAlerts.declined + 1);
    expect(
      ((await api(admin).get(`/orders/${order.id}`).expect(200)).body as { staffAlert: string })
        .staffAlert,
    ).toBe('DECLINED');
    await api(admin).delete(`/assignments/${missionId}`).expect(200);
    expect(
      (
        (await api(admin).get(`/orders/${order.id}`).expect(200)).body as {
          staffAlert: string | null;
        }
      ).staffAlert,
    ).toBeNull();

    // Mission dans moins de 48 h, non confirmée
    const soon = await createOrder(1);
    const tomorrow = casablancaDay(1);
    await assign(soon.id, otherDriver, 'DRIVER', `${tomorrow}T08:00`, `${tomorrow}T23:00`).expect(
      201,
    );
    expect(
      ((await api(admin).get(`/orders/${soon.id}`).expect(200)).body as { staffAlert: string })
        .staffAlert,
    ).toBe('UNCONFIRMED');
  });

  it('livraison : le chauffeur fait avancer la commande ; l’équipe n’a pas cette action', async () => {
    const day = casablancaDay(33);
    const order = await createOrder(33);
    const staffing = (
      await assign(order.id, driver, 'DRIVER', `${day}T17:00`, `${day}T20:00`).expect(201)
    ).body as Staffing;
    const missionId = staffing.assignments[0]?.id ?? '';
    const confirmed = (await api(driver).get(`/me/missions/${missionId}`).expect(200))
      .body as MissionBody;
    expect(confirmed.deliverySteps).toEqual([]);

    const current = (await api(admin).get(`/orders/${order.id}`).expect(200)).body as {
      version: number;
    };
    await api(admin)
      .post(`/orders/${order.id}/transitions`, { to: 'IN_PREPARATION', version: current.version })
      .expect(200);
    const ready = (await api(driver).get(`/me/missions/${missionId}`).expect(200))
      .body as MissionBody;
    expect(ready.deliverySteps).toEqual(['OUT_FOR_DELIVERY', 'DELIVERED']);
    await api(driver)
      .post(`/me/missions/${missionId}/delivery`, { to: 'OUT_FOR_DELIVERY' })
      .expect(200);
    const out = (await api(admin).get(`/orders/${order.id}`).expect(200)).body as {
      status: string;
    };
    expect(out.status).toBe('OUT_FOR_DELIVERY');

    const cookStaffing = (
      await assign(order.id, cook, 'COOK', `${day}T10:00`, `${day}T16:00`).expect(201)
    ).body as Staffing;
    const cookMission = cookStaffing.assignments.find((item) => item.staffRole === 'COOK');
    await api(cook)
      .post(`/me/missions/${cookMission?.id ?? ''}/delivery`, { to: 'DELIVERED' })
      .expect(403);
    await api(driver).post(`/me/missions/${missionId}/delivery`, { to: 'DELIVERED' }).expect(200);
  });

  it('documents : bon de livraison (chauffeur), bon de préparation (cuisine), bon du jour', async () => {
    const day = casablancaDay(34);
    const order = await createOrder(34);
    const driverStaffing = (
      await assign(order.id, driver, 'DRIVER', `${day}T17:00`, `${day}T20:00`).expect(201)
    ).body as Staffing;
    const cookStaffing = (
      await assign(order.id, cook, 'COOK', `${day}T09:00`, `${day}T16:00`).expect(201)
    ).body as Staffing;
    const driverMission =
      driverStaffing.assignments.find((item) => item.staffRole === 'DRIVER')?.id ?? '';
    const cookMission =
      cookStaffing.assignments.find((item) => item.staffRole === 'COOK')?.id ?? '';

    const pdf = async (response: request.Response) => {
      const { url } = response.body as { url: string };
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    };
    await pdf(await api(driver).get(`/me/missions/${driverMission}/delivery-note`).expect(200));
    await api(driver).get(`/me/missions/${driverMission}/preparation-sheet`).expect(403);
    await pdf(
      await api(cook).get(`/me/missions/${cookMission}/preparation-sheet?locale=ar`).expect(200),
    );
    await api(cook).get(`/me/missions/${cookMission}/delivery-note`).expect(403);
    await pdf(await api(admin).get(`/calendar/preparation-sheet?date=${day}`).expect(200));
    await pdf(await api(admin).get(`/orders/${order.id}/delivery-note`).expect(200));
    await api(driver).get(`/orders/${order.id}/delivery-note`).expect(403);
  });

  it('mission terminée depuis le délai réglé : adresse, contact et téléphones masqués', async () => {
    const day = casablancaDay(35);
    const order = await createOrder(35);
    const staffing = (
      await assign(order.id, driver, 'DRIVER', `${day}T17:00`, `${day}T20:00`).expect(201)
    ).body as Staffing;
    const missionId = staffing.assignments[0]?.id ?? '';
    const past = new Date(Date.now() - 10 * 86_400_000);
    await prisma.order.update({
      where: { id: order.id },
      data: { eventDate: past, eventEndDate: null },
    });
    await prisma.staffAssignment.update({
      where: { id: missionId },
      data: { startAt: new Date(past.getTime() - 3_600_000), endAt: past },
    });
    const masked = (await api(driver).get(`/me/missions/${missionId}`).expect(200))
      .body as MissionBody;
    expect(masked).toMatchObject({
      redacted: true,
      venue: null,
      contact: null,
      place: 'Casablanca',
    });
    expect(masked.team.every((member) => member.phone === null)).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('Hassan II');
    const passed = (await api(driver).get('/me/missions?scope=past').expect(200))
      .body as MissionBody[];
    expect(passed.find((item) => item.id === missionId)?.place).toBe('Casablanca');

    // Réglable : sans délai, rien n'est masqué
    await prisma.traiteur.update({
      where: { id: admin.traiteurId },
      data: { missionRedactionDays: null },
    });
    const visible = (await api(driver).get(`/me/missions/${missionId}`).expect(200))
      .body as MissionBody;
    expect(visible.redacted).toBe(false);
    await prisma.traiteur.update({
      where: { id: admin.traiteurId },
      data: { missionRedactionDays: 7 },
    });
  });
});
