import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { hashLinkToken } from '../../src/common/link-token';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';
import { getTestDatabaseUrl } from './test-database-url';

/** Commande de création d'un traiteur en production (sans seed de démonstration). */
const run = promisify(execFile);
const randomPhone = () => `06${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function createTraiteur(args: string[]) {
  try {
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'src/cli/create-traiteur.ts', ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: getTestDatabaseUrl(),
          PUBLIC_WEB_URL: 'https://app.exemple.ma',
        },
      },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

describe('create-traiteur (ligne de commande)', () => {
  let prisma: PrismaClient;
  const slug = `pilote-${randomUUID().slice(0, 8)}`;
  const adminPhone = randomPhone();

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crée le traiteur, ses fonctionnalités et un administrateur invité, sans mot de passe', async () => {
    const result = await createTraiteur([
      '--slug',
      slug,
      '--name',
      'Traiteur Pilote',
      '--email',
      'contact@pilote.ma',
      '--phone',
      '0522000000',
      '--city',
      'Casablanca',
      '--plan',
      'PRO',
      '--admin-phone',
      adminPhone,
      '--admin-first-name',
      'Karim',
      '--admin-last-name',
      'Benjelloun',
    ]);
    expect(result.code).toBe(0);
    const link = /https:\/\/app\.exemple\.ma\/invitation\/([A-Za-z0-9_-]{43})/.exec(result.stdout);
    expect(link).not.toBeNull();

    const traiteur = await prisma.traiteur.findUniqueOrThrow({
      where: { slug },
      include: { featureFlags: true, memberships: { include: { user: true } } },
    });
    expect(traiteur).toMatchObject({ status: 'ACTIVE', plan: 'PRO', phone: '+212522000000' });
    expect(traiteur.featureFlags.filter((flag) => flag.enabled).map((flag) => flag.key)).toEqual(
      expect.arrayContaining(['quotes', 'invoices', 'staff_app']),
    );
    expect(traiteur.memberships).toHaveLength(1);
    const admin = traiteur.memberships[0];
    expect(admin).toMatchObject({ role: 'ADMIN_TRAITEUR', status: 'INVITED' });
    expect(admin?.user.passwordHash).toBeNull();
    // Le lien affiché correspond à l'invitation enregistrée (seule son empreinte est stockée)
    const invitation = await prisma.staffInvitation.findFirstOrThrow({
      where: { membershipId: admin?.id },
    });
    expect(invitation.tokenHash).toBe(hashLinkToken(link?.[1] ?? ''));
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // Aucune donnée de démonstration
    expect(await prisma.order.count({ where: { traiteurId: traiteur.id } })).toBe(0);
    expect(await prisma.dish.count({ where: { traiteurId: traiteur.id } })).toBe(0);
  });

  it('refuse un slug déjà pris ou des paramètres invalides', async () => {
    const taken = await createTraiteur([
      '--slug',
      slug,
      '--name',
      'Doublon',
      '--email',
      'x@pilote.ma',
      '--phone',
      '0522000000',
      '--city',
      'Rabat',
      '--admin-phone',
      randomPhone(),
      '--admin-first-name',
      'A',
      '--admin-last-name',
      'B',
    ]);
    expect(taken.code).toBe(1);
    expect(taken.stderr).toContain('déjà utilisé');

    const invalid = await createTraiteur(['--slug', 'Pas Valide', '--admin-phone', '123']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('--slug');
    expect(invalid.stderr).toContain('--admin-phone');
  });
});
