import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { OtpService } from '../../src/auth/otp/otp.service';
import { PasswordService } from '../../src/auth/password.service';
import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Connexion à l'espace de gestion : jamais d'inscription automatique comme client, un
 * Membership du personnel actif chez CE traiteur est exigé, et la réponse ne révèle pas si le
 * compte existe chez un autre traiteur.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const PASSWORD = 'MotDePasse2026';

describe('Connexion à l’espace de gestion (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let otp: OtpService;
  let passwordHash: string;

  const server = (): App => app.getHttpServer() as App;

  async function createTraiteur(name: string) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `espace-${suffix}`,
        name: `${name} ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
  }

  async function createMember(traiteurId: string, role: Role) {
    const user = await prisma.user.create({
      data: { phone: randomPhone(), passwordHash, firstName: 'Samir', lastName: role },
    });
    await prisma.membership.create({
      data: { traiteurId, userId: user.id, role, firstName: 'Samir', lastName: role },
    });
    return user;
  }

  const login = (traiteurSlug: string, identifier: string, space?: 'backoffice' | 'client') =>
    request(server())
      .post('/api/v1/auth/login')
      .send({ traiteurSlug, identifier, password: PASSWORD, ...(space ? { space } : {}) });

  /** Code SMS de connexion valable, posé directement en base (aucun SMS envoyé). */
  async function loginCode(phone: string): Promise<string> {
    const code = String(Math.floor(100_000 + Math.random() * 899_999));
    await prisma.otpCode.create({
      data: {
        phone,
        purpose: 'LOGIN',
        codeHash: otp.hashCode(phone, 'LOGIN', code),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    return code;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    otp = app.get(OtpService);
    passwordHash = await app.get(PasswordService).hash(PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('administrateur d’un autre traiteur : refusé, aucun Membership créé, rien sur l’autre traiteur', async () => {
    const darDiafa = await createTraiteur('Dar Diafa');
    const other = await createTraiteur('Saveurs');
    const admin = await createMember(other.id, 'ADMIN_TRAITEUR');

    const refused = await login(darDiafa.slug, admin.phone, 'backoffice').expect(403);
    expect(refused.body).toMatchObject({ code: 'NO_BACKOFFICE_ACCESS' });
    expect((refused.body as { message: string }).message).toContain(darDiafa.name);
    expect(JSON.stringify(refused.body)).not.toContain(other.name);
    expect(JSON.stringify(refused.body)).not.toContain(other.slug);
    expect(
      await prisma.membership.count({ where: { userId: admin.id, traiteurId: darDiafa.id } }),
    ).toBe(0);
    // Tracé au niveau de la plateforme, pas dans le journal de Dar Diafa
    const denied = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.backoffice_denied', entityId: admin.id },
    });
    expect(denied.traiteurId).toBeNull();

    // Chez son propre traiteur : accès normal
    const session = await login(other.slug, admin.phone, 'backoffice').expect(200);
    expect(session.body).toMatchObject({
      context: { traiteurId: other.id, role: 'ADMIN_TRAITEUR' },
    });
  });

  it('un client n’entre pas dans l’espace de gestion ; l’application client garde l’inscription', async () => {
    const traiteur = await createTraiteur('Dar Diafa');
    const elsewhere = await createTraiteur('Saveurs');
    const customer = await createMember(traiteur.id, 'CLIENT');

    const refused = await login(traiteur.slug, customer.phone, 'backoffice').expect(403);
    expect(refused.body).toMatchObject({ code: 'NO_BACKOFFICE_ACCESS' });

    // Application client (sans espace) : un client existant peut commander chez un autre traiteur
    const joined = await login(elsewhere.slug, customer.phone).expect(200);
    expect(joined.body).toMatchObject({ context: { traiteurId: elsewhere.id, role: 'CLIENT' } });
  });

  it('code SMS : numéro inconnu ou membre d’ailleurs, même réponse, aucun compte créé', async () => {
    const traiteur = await createTraiteur('Dar Diafa');
    const other = await createTraiteur('Saveurs');
    const admin = await createMember(other.id, 'EMPLOYE');
    const unknown = randomPhone();

    const responses = [];
    for (const phone of [unknown, admin.phone]) {
      const response = await request(server())
        .post('/api/v1/auth/otp/verify')
        .send({
          traiteurSlug: traiteur.slug,
          phone,
          code: await loginCode(phone),
          space: 'backoffice',
          firstName: 'Intrus',
          lastName: 'Test',
        })
        .expect(403);
      responses.push(response.body as { code: string; message: string });
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toMatchObject({ code: 'NO_BACKOFFICE_ACCESS' });
    expect(await prisma.user.count({ where: { phone: unknown } })).toBe(0);
    expect(
      await prisma.membership.count({ where: { userId: admin.id, traiteurId: traiteur.id } }),
    ).toBe(0);
    // Le code est consommé : il ne peut pas être rejoué
    expect(await prisma.otpCode.count({ where: { phone: unknown, usedAt: { not: null } } })).toBe(
      1,
    );

    // Chez son traiteur, le même membre se connecte par code SMS
    await request(server())
      .post('/api/v1/auth/otp/verify')
      .send({
        traiteurSlug: other.slug,
        phone: admin.phone,
        code: await loginCode(admin.phone),
        space: 'backoffice',
      })
      .expect(200);
  });
});
