/**
 * Comptes de la plateforme (SUPER_ADMIN), sur le serveur uniquement (accès SSH : impossible
 * depuis Internet). Chaque commande affiche un résumé de ce qu'elle va faire, demande de taper
 * « oui », puis inscrit l'opération au journal d'audit.
 *
 * Créer le super admin (lien d'activation de 24 heures, à usage unique ; la double
 * authentification est imposée à sa première connexion) :
 *
 *   /opt/traiteur/scripts/compose.sh run --rm api node dist/cli/super-admin.js create \
 *     --phone 0612345678 --first-name Ahmed --last-name R. [--email moi@exemple.ma] \
 *     [--allow-additional]
 *
 * Réinitialiser sa double authentification (téléphone ET codes de secours perdus) : secret,
 * codes de secours et sessions révoqués ; nouvelle activation imposée à la connexion suivante :
 *
 *   /opt/traiteur/scripts/compose.sh run --rm api node dist/cli/super-admin.js reset-2fa \
 *     --phone 0612345678
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { type AuditAction, ACTIVATION_TTL_HOURS, phoneSchema } from '@traiteur/shared';
import { z } from 'zod';

import { newLinkToken } from '../common/link-token';
import type { PrismaClient } from '../generated/prisma/client';
import { cliPrisma } from './cli-prisma';

/** Sortie de la commande (les erreurs passent par console.error). */
const print = (message = ''): void => {
  process.stdout.write(`${message}\n`);
};

class CliError extends Error {}

/** Confirmation explicite : seule la réponse « oui » exécute la commande. */
async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('\nTapez « oui » pour confirmer : ');
    return answer.trim().toLowerCase() === 'oui';
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

const createSchema = z.object({
  phone: phoneSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
  locale: z.enum(['fr', 'ar']).default('fr'),
  allowAdditional: z.boolean(),
  webUrl: z.url(),
});

async function create(prisma: PrismaClient, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      phone: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
      email: { type: 'string' },
      locale: { type: 'string' },
      'allow-additional': { type: 'boolean', default: false },
    },
  });
  const parsed = createSchema.safeParse({
    phone: values.phone,
    firstName: values['first-name'],
    lastName: values['last-name'],
    email: values.email,
    locale: values.locale,
    allowAdditional: values['allow-additional'],
    webUrl: process.env.PUBLIC_WEB_URL,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `--${String(issue.path[0] ?? '')}`);
    throw new CliError(
      `Paramètres invalides : ${[...new Set(fields)].join(', ')}. Voir docs/deploiement.md.`,
    );
  }
  const args = parsed.data;

  const existing = await prisma.user.findMany({
    where: { isSuperAdmin: true },
    select: { firstName: true, lastName: true, phone: true },
  });
  if (existing.length > 0 && !args.allowAdditional) {
    throw new CliError(
      `Un super admin existe déjà (${existing.map((user) => `${user.firstName} ${user.lastName}`).join(', ')}). ` +
        'Pour en créer un deuxième, relancez avec --allow-additional.',
    );
  }
  const taken = await prisma.user.findFirst({
    where: { OR: [{ phone: args.phone }, ...(args.email ? [{ email: args.email }] : [])] },
    select: { id: true },
  });
  if (taken) {
    throw new CliError(
      'Ce téléphone ou cet email appartient déjà à un compte (client ou personnel) : utilisez un numéro dédié au compte de la plateforme.',
    );
  }

  print('Création d’un compte SUPER ADMIN (accès à toute la plateforme)');
  print(`  Nom        : ${args.firstName} ${args.lastName}`);
  print(`  Téléphone  : ${args.phone}`);
  print(`  Email      : ${args.email ?? '—'}`);
  if (existing.length > 0) print(`  ⚠ Super admin supplémentaire (déjà ${existing.length})`);
  print(`  Lien d’activation : valable ${ACTIVATION_TTL_HOURS} h, à usage unique`);
  print('  Double authentification : imposée à la première connexion');
  if (!(await confirm())) {
    print('Annulé : rien n’a été modifié.');
    process.exitCode = 1;
    return;
  }

  const { token, hash } = newLinkToken();
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phone: args.phone,
        email: args.email ?? null,
        firstName: args.firstName,
        lastName: args.lastName,
        locale: args.locale,
        isSuperAdmin: true,
      },
    });
    await tx.accountActivation.create({
      data: {
        userId: created.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + ACTIVATION_TTL_HOURS * 3_600_000),
      },
    });
    await tx.auditLog.create({
      data: {
        traiteurId: null,
        action: 'super_admin.created' satisfies AuditAction,
        entityType: 'User',
        entityId: created.id,
        after: {
          phone: args.phone,
          additional: existing.length > 0,
          via: 'cli',
        },
      },
    });
    return created;
  });
  print(`\n✓ Super admin créé : ${user.firstName} ${user.lastName}`);
  print(`\nLien d’activation (valable ${ACTIVATION_TTL_HOURS} h, une seule fois) :`);
  print(`${args.webUrl.replace(/\/+$/, '')}/activation/${token}`);
  print(
    '\nOuvrez-le vous-même pour choisir le mot de passe, puis connectez-vous : la double authentification vous sera demandée. Rangez les codes de secours avec la clé des sauvegardes.',
  );
}

async function resetTwoFactor(prisma: PrismaClient, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { phone: { type: 'string' }, email: { type: 'string' } },
  });
  const phone = values.phone ? phoneSchema.safeParse(values.phone) : null;
  if (phone && !phone.success) throw new CliError('--phone invalide');
  if (!phone && !values.email) throw new CliError('Indiquez --phone ou --email du super admin.');
  const user = await prisma.user.findFirst({
    where: phone?.success ? { phone: phone.data } : { email: values.email?.toLowerCase() },
    include: {
      _count: {
        select: {
          refreshTokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
          recoveryCodes: { where: { usedAt: null } },
        },
      },
    },
  });
  if (!user) throw new CliError('Aucun compte avec ce téléphone ou cet email.');
  if (!user.isSuperAdmin) {
    throw new CliError(
      'Ce compte n’est pas un super admin : sa double authentification se gère depuis « Mon compte ».',
    );
  }

  print('Réinitialisation de la double authentification d’un SUPER ADMIN');
  print(`  Compte : ${user.firstName} ${user.lastName} (${user.phone})`);
  print(
    `  Double authentification : ${user.twoFactorEnabledAt ? `active depuis le ${user.twoFactorEnabledAt.toISOString().slice(0, 10)}` : 'inactive'}`,
  );
  print('Effets :');
  print('  - le secret actuel est effacé : l’ancien téléphone ne génère plus de codes valides ;');
  print(`  - codes de secours encore valables annulés : ${user._count.recoveryCodes} ;`);
  print(`  - sessions ouvertes fermées : ${user._count.refreshTokens} ;`);
  print('  - une nouvelle activation (QR code) sera imposée à la prochaine connexion.');
  if (!(await confirm())) {
    print('Annulé : rien n’a été modifié.');
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.twoFactorChallenge.deleteMany({ where: { userId: user.id } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorLastStep: null,
      },
    });
    await tx.auditLog.create({
      data: {
        traiteurId: null,
        action: 'super_admin.2fa_reset' satisfies AuditAction,
        entityType: 'User',
        entityId: user.id,
        after: {
          via: 'cli',
          recoveryCodesRevoked: user._count.recoveryCodes,
          sessionsRevoked: user._count.refreshTokens,
        },
      },
    });
  });
  print('\n✓ Double authentification réinitialisée, sessions fermées.');
  print(
    'À la prochaine connexion : mot de passe, puis nouveau QR code à scanner et nouveaux codes de secours à ranger avec la clé des sauvegardes.',
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const prisma = cliPrisma();
  try {
    if (command === 'create') await create(prisma, rest);
    else if (command === 'reset-2fa') await resetTwoFactor(prisma, rest);
    else
      throw new CliError(
        'Commande inconnue. Usage : super-admin create | reset-2fa (voir docs/deploiement.md).',
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
