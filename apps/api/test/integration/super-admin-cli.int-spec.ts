import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';
import { getTestDatabaseUrl } from './test-database-url';

/**
 * Commande serveur « super-admin » : création (lien d'activation de 24 h, refus d'un deuxième
 * super admin sans option, confirmation) et réinitialisation de secours de la double
 * authentification (secret, codes de secours et sessions révoqués, audit).
 */
const randomPhone = () => `06${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const toE164 = (phone: string) => `+212${phone.slice(1)}`;

/** Lance la commande et répond `answer` à la confirmation. */
function superAdmin(args: string[], answer: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/super-admin.ts', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: getTestDatabaseUrl(),
        PUBLIC_WEB_URL: 'https://app.exemple.ma',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end(`${answer}\n`);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe('super-admin (ligne de commande)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;
  const server = (): App => app.getHttpServer() as App;
  // Adresse différente à chaque appel : la limitation de débit n'est pas l'objet de ces tests
  const post = (path: string, body: object) =>
    request(server())
      .post(`/api/v1${path}`)
      .set(
        'X-Forwarded-For',
        `41.251.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      )
      .send(body);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    // Un super admin existe déjà sur la plateforme
    await prisma.user.create({
      data: {
        phone: toE164(randomPhone()),
        firstName: 'Premier',
        lastName: 'Admin',
        isSuperAdmin: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('création : refus d’un deuxième super admin sans option, confirmation exigée', async () => {
    const phone = randomPhone();
    const args = ['create', '--phone', phone, '--first-name', 'Ahmed', '--last-name', 'R.'];

    const refused = await superAdmin(args, 'oui');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--allow-additional');

    const cancelled = await superAdmin([...args, '--allow-additional'], 'non');
    expect(cancelled.code).toBe(1);
    expect(cancelled.stdout).toContain('Création d’un compte SUPER ADMIN');
    expect(cancelled.stdout).toContain('Annulé');
    expect(await prisma.user.findUnique({ where: { phone: toE164(phone) } })).toBeNull();

    const created = await superAdmin([...args, '--allow-additional'], 'oui');
    expect(created.code).toBe(0);
    const link = /https:\/\/app\.exemple\.ma\/activation\/([A-Za-z0-9_-]{43})/.exec(created.stdout);
    expect(link).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({
      where: { phone: toE164(phone) },
      include: { accountActivations: true },
    });
    expect(user).toMatchObject({ isSuperAdmin: true, passwordHash: null });
    const [activation] = user.accountActivations;
    const hours = ((activation?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(
      await prisma.auditLog.count({ where: { entityId: user.id, action: 'super_admin.created' } }),
    ).toBe(1);

    // Activation : mot de passe faible refusé, puis choisi une seule fois
    const token = link?.[1] ?? '';
    const view = await request(server()).get(`/api/v1/public/activations/${token}`).expect(200);
    expect(view.body).toMatchObject({ firstName: 'Ahmed' });
    expect(JSON.stringify(view.body)).not.toContain(phone.slice(2, 8));
    await post(`/public/activations/${token}`, { password: 'court' }).expect(400);
    await post(`/public/activations/${token}`, { password: 'Plateforme-2026' }).expect(200);
    await post(`/public/activations/${token}`, { password: 'Plateforme-2026' }).expect(404);

    // Première connexion : double authentification imposée avant toute session
    const login = await post('/auth/login', {
      identifier: toE164(phone),
      password: 'Plateforme-2026',
    }).expect(200);
    expect(login.body).toMatchObject({ twoFactor: 'SETUP' });
  });

  it('création : un numéro déjà utilisé par un client ou un membre est refusé', async () => {
    const phone = randomPhone();
    await prisma.user.create({
      data: { phone: toE164(phone), firstName: 'Client', lastName: 'X' },
    });
    const result = await superAdmin(
      ['create', '--phone', phone, '--first-name', 'A', '--last-name', 'B', '--allow-additional'],
      'oui',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('appartient déjà');
  });

  it('reset-2fa : secret, codes de secours et sessions révoqués, nouvelle activation imposée', async () => {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: {
        phone: toE164(phone),
        firstName: 'Perdu',
        lastName: 'Téléphone',
        isSuperAdmin: true,
        twoFactorSecret: 'v1:a:b:c',
        twoFactorEnabledAt: new Date(),
        twoFactorLastStep: 1,
        recoveryCodes: { create: [{ codeHash: randomUUID() }, { codeHash: randomUUID() }] },
        refreshTokens: {
          create: {
            tokenHash: randomUUID(),
            familyId: randomUUID(),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        },
      },
    });

    const cancelled = await superAdmin(['reset-2fa', '--phone', phone], '');
    expect(cancelled.code).toBe(1);
    expect(cancelled.stdout).toContain('codes de secours encore valables annulés : 2');
    expect(cancelled.stdout).toContain('sessions ouvertes fermées : 1');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabledAt,
    ).not.toBeNull();

    const reset = await superAdmin(['reset-2fa', '--phone', phone], 'oui');
    expect(reset.code).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorLastStep: null,
    });
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
    const [audit] = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'super_admin.2fa_reset' },
    });
    expect(audit?.after).toMatchObject({ recoveryCodesRevoked: 2, sessionsRevoked: 1 });

    // Un compte qui n'est pas super admin : refusé
    const staffPhone = randomPhone();
    await prisma.user.create({
      data: { phone: toE164(staffPhone), firstName: 'Employé', lastName: 'Y' },
    });
    const refused = await superAdmin(['reset-2fa', '--phone', staffPhone], 'oui');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('n’est pas un super admin');
  });
});
