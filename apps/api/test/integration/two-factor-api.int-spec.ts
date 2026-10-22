import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PasswordService } from '../../src/auth/password.service';
import { totpCode, totpStep } from '../../src/auth/two-factor/totp';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Double authentification : activation imposée au SUPER_ADMIN avant toute session, deuxième
 * étape (code sans rejeu, codes de secours à usage unique, 5 essais par jeton), activation
 * facultative et désactivation pour les autres comptes.
 */
interface Session {
  accessToken: string;
  refreshToken: string;
  user: { twoFactorEnabled: boolean };
  context: { role: string };
}
interface Challenge {
  twoFactor: 'VERIFY' | 'SETUP';
  challengeToken: string;
}

const PASSWORD = 'Motdepasse-2FA-123!';
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
/** Code de l'application pour le pas courant (+ décalage). */
const codeFor = (secret: string, offset = 0) =>
  totpCode(secret.replace(/\s/g, ''), totpStep(new Date()) + offset);

describe('Double authentification (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let slug: string;
  let passwordHash: string;

  const server = (): App => app.getHttpServer() as App;
  const post = (path: string, body: object, token?: string) => {
    // Adresse différente à chaque appel : la limitation de débit n'est pas l'objet de ces tests
    const call = request(server())
      .post(`/api/v1${path}`)
      .set(
        'X-Forwarded-For',
        `41.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      );
    return (token ? call.set('Authorization', `Bearer ${token}`) : call).send(body);
  };
  const get = (path: string, token: string) =>
    request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

  async function createUser(options: { superAdmin?: boolean; role?: 'ADMIN_TRAITEUR' }) {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: {
        phone,
        firstName: 'Test',
        lastName: '2FA',
        passwordHash,
        isSuperAdmin: options.superAdmin ?? false,
      },
    });
    if (options.role) {
      const traiteur = await prisma.traiteur.findUniqueOrThrow({ where: { slug } });
      await prisma.membership.create({
        data: {
          traiteurId: traiteur.id,
          userId: user.id,
          role: options.role,
          firstName: 'Test',
          lastName: '2FA',
        },
      });
    }
    return { id: user.id, phone };
  }

  const login = (phone: string, withSlug: boolean) =>
    post('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      ...(withSlug ? { traiteurSlug: slug } : {}),
    }).expect(200);

  /** Super admin : activation imposée à la première connexion ; retourne secret et codes. */
  async function enrolSuperAdmin(phone: string) {
    const challenge = (await login(phone, false)).body as Challenge;
    expect(challenge.twoFactor).toBe('SETUP');
    const info = (
      await post('/auth/2fa/setup', { challengeToken: challenge.challengeToken }).expect(200)
    ).body as { secret: string; qrSvg: string; otpauthUri: string };
    const confirmed = (
      await post('/auth/2fa/setup/confirm', {
        challengeToken: challenge.challengeToken,
        code: codeFor(info.secret),
      }).expect(200)
    ).body as { session: Session; recoveryCodes: string[] };
    return { info, ...confirmed };
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    passwordHash = await app.get(PasswordService).hash(PASSWORD);
    slug = `deux-facteurs-${randomUUID().slice(0, 8)}`;
    await prisma.traiteur.create({
      data: {
        slug,
        name: 'Traiteur 2FA',
        email: 'test@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('SUPER_ADMIN : aucune session avant l’activation, puis QR code, session et 10 codes de secours', async () => {
    const admin = await createUser({ superAdmin: true });
    const { info, session, recoveryCodes } = await enrolSuperAdmin(admin.phone);
    expect(info.qrSvg).toMatch(/^<svg/);
    expect(info.otpauthUri).toMatch(/^otpauth:\/\/totp\/Gestion%20Traiteurs/);
    expect(recoveryCodes).toHaveLength(10);
    expect(session.context.role).toBe('SUPER_ADMIN');
    expect(session.user.twoFactorEnabled).toBe(true);

    // Secret chiffré en base, codes de secours en empreinte seulement
    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.twoFactorSecret).toMatch(/^v1:/);
    expect(row.twoFactorSecret).not.toContain(info.secret.replace(/\s/g, ''));
    const stored = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: admin.id } });
    expect(stored.map((code) => code.codeHash)).not.toContain(recoveryCodes[0]);
    expect(
      await prisma.auditLog.count({ where: { entityId: admin.id, action: 'auth.2fa_enabled' } }),
    ).toBe(1);

    // Imposée : impossible à désactiver
    expect(
      (
        await post(
          '/me/two-factor/disable',
          { code: codeFor(info.secret, 1) },
          session.accessToken,
        ).expect(403)
      ).body,
    ).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('deuxième étape : code sans rejeu, code de secours à usage unique', async () => {
    const admin = await createUser({ superAdmin: true });
    const { info, recoveryCodes } = await enrolSuperAdmin(admin.phone);

    // Le code de l'activation (pas courant) ne sert pas deux fois ; le pas suivant est accepté
    const first = (await login(admin.phone, false)).body as Challenge;
    expect(first.twoFactor).toBe('VERIFY');
    expect(
      (
        await post('/auth/2fa/verify', {
          challengeToken: first.challengeToken,
          code: codeFor(info.secret),
        }).expect(401)
      ).body,
    ).toMatchObject({ code: 'INVALID_TWO_FACTOR_CODE' });
    const session = (
      await post('/auth/2fa/verify', {
        challengeToken: first.challengeToken,
        code: codeFor(info.secret, 1),
      }).expect(200)
    ).body as Session;
    expect(session.context.role).toBe('SUPER_ADMIN');
    // Jeton consommé : inutilisable une seconde fois
    await post('/auth/2fa/verify', {
      challengeToken: first.challengeToken,
      code: recoveryCodes[0],
    }).expect(401);

    // Code de secours (format libre), puis refusé à la deuxième utilisation
    const second = (await login(admin.phone, false)).body as Challenge;
    const recovery = (recoveryCodes[0] ?? '').toLowerCase().replace('-', ' ');
    await post('/auth/2fa/verify', {
      challengeToken: second.challengeToken,
      code: recovery,
    }).expect(200);
    const third = (await login(admin.phone, false)).body as Challenge;
    await post('/auth/2fa/verify', {
      challengeToken: third.challengeToken,
      code: recoveryCodes[0],
    }).expect(401);
    expect(
      await prisma.auditLog.count({
        where: { entityId: admin.id, action: 'auth.2fa_recovery_code_used' },
      }),
    ).toBe(1);
  });

  it('5 essais par jeton, et un jeton d’un autre type est refusé', async () => {
    const admin = await createUser({ superAdmin: true });
    await enrolSuperAdmin(admin.phone);
    // Les échecs comptent aussi pour le verrouillage du compte : on repart de zéro ensuite
    const challenge = (await login(admin.phone, false)).body as Challenge;
    await post('/auth/2fa/setup', { challengeToken: challenge.challengeToken }).expect(401);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/auth/2fa/verify', {
        challengeToken: challenge.challengeToken,
        code: '000000',
      }).expect(401);
    }
    expect(
      (
        await post('/auth/2fa/verify', {
          challengeToken: challenge.challengeToken,
          code: '000000',
        }).expect(401)
      ).body,
    ).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
    expect(
      await prisma.auditLog.count({ where: { entityId: admin.id, action: 'auth.2fa_failed' } }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('SUPER_ADMIN sans double authentification : sa session existante est refusée', async () => {
    const admin = await createUser({ superAdmin: true });
    // Session émise avant l'obligation (ancienne version) : simulée par une connexion d'un
    // compte qui n'était pas encore super admin
    await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: false } });
    const traiteur = await prisma.traiteur.findUniqueOrThrow({ where: { slug } });
    await prisma.membership.create({
      data: {
        traiteurId: traiteur.id,
        userId: admin.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'T',
        lastName: 'S',
      },
    });
    const session = (await login(admin.phone, true)).body as Session;
    await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
    await post('/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
  });

  it('administrateur : activation facultative depuis « Mon compte », codes régénérés, désactivation', async () => {
    const admin = await createUser({ role: 'ADMIN_TRAITEUR' });
    const session = (await login(admin.phone, true)).body as Session;
    expect(session.user.twoFactorEnabled).toBe(false);
    expect((await get('/me/two-factor', session.accessToken).expect(200)).body).toMatchObject({
      enabled: false,
      required: false,
    });

    const info = (await post('/me/two-factor/setup', {}, session.accessToken).expect(200)).body as {
      secret: string;
    };
    await post('/me/two-factor/confirm', { code: '123456' }, session.accessToken).expect(401);
    const enabled = (
      await post(
        '/me/two-factor/confirm',
        { code: codeFor(info.secret) },
        session.accessToken,
      ).expect(200)
    ).body as { recoveryCodes: string[] };
    expect(enabled.recoveryCodes).toHaveLength(10);
    await post('/me/two-factor/setup', {}, session.accessToken).expect(409);

    // Connexion suivante : deuxième étape
    const challenge = (await login(admin.phone, true)).body as Challenge;
    expect(challenge.twoFactor).toBe('VERIFY');

    // Nouveaux codes : les anciens ne valent plus rien
    const regenerated = (
      await post(
        '/me/two-factor/recovery-codes',
        { code: codeFor(info.secret, 1) },
        session.accessToken,
      ).expect(200)
    ).body as { recoveryCodes: string[] };
    await post('/auth/2fa/verify', {
      challengeToken: challenge.challengeToken,
      code: enabled.recoveryCodes[0],
    }).expect(401);
    await post('/auth/2fa/verify', {
      challengeToken: challenge.challengeToken,
      code: regenerated.recoveryCodes[0],
    }).expect(200);

    // Désactivation avec un code de secours : connexion directe ensuite
    await post(
      '/me/two-factor/disable',
      { code: regenerated.recoveryCodes[1] },
      session.accessToken,
    ).expect(204);
    const direct = (await login(admin.phone, true)).body as Session;
    expect(direct.accessToken).toBeTruthy();
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: admin.id,
          action: {
            in: ['auth.2fa_enabled', 'auth.2fa_recovery_codes_regenerated', 'auth.2fa_disabled'],
          },
        },
      }),
    ).toBe(3);
  });
});
