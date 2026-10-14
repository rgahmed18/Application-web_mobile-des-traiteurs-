/**
 * Crée un traiteur en production (sans aucune donnée de démonstration) et son premier
 * administrateur. L'administrateur reçoit un lien d'activation (7 jours) pour choisir son mot
 * de passe : aucun mot de passe ne transite par la ligne de commande ni par les journaux.
 *
 *   docker compose run --rm api node dist/cli/create-traiteur.js \
 *     --slug dar-diafa --name "Dar Diafa" --email contact@dardiafa.ma --phone 0522000000 \
 *     --city Casablanca --plan PRO \
 *     --admin-phone 0612345678 --admin-first-name Karim --admin-last-name Benjelloun
 *
 * Ensuite : TRAITEUR_SLUG=<slug> dans la configuration du back-office (un back-office par
 * traiteur pour l'instant), puis ouvrir le lien affiché et l'envoyer à l'administrateur.
 */
import { parseArgs } from 'node:util';

import { getDefaultFeatureFlags, phoneSchema, SUBSCRIPTION_PLANS } from '@traiteur/shared';
import { z } from 'zod';

import { syncPermissionCatalog } from '../access/permission-catalog';
import { newLinkToken } from '../common/link-token';
import { cliPrisma } from './cli-prisma';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const argsSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lettres minuscules, chiffres et tirets (ex. dar-diafa)')
    .max(60),
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(80),
  plan: z.enum(SUBSCRIPTION_PLANS).default('PRO'),
  locale: z.enum(['fr', 'ar']).default('fr'),
  adminPhone: phoneSchema,
  adminFirstName: z.string().trim().min(1).max(80),
  adminLastName: z.string().trim().min(1).max(80),
  webUrl: z.url(),
});

function readArgs() {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      city: { type: 'string' },
      plan: { type: 'string' },
      locale: { type: 'string' },
      'admin-phone': { type: 'string' },
      'admin-first-name': { type: 'string' },
      'admin-last-name': { type: 'string' },
    },
  });
  const parsed = argsSchema.safeParse({
    slug: values.slug,
    name: values.name,
    email: values.email,
    phone: values.phone,
    city: values.city,
    plan: values.plan,
    locale: values.locale,
    adminPhone: values['admin-phone'],
    adminFirstName: values['admin-first-name'],
    adminLastName: values['admin-last-name'],
    webUrl: process.env.PUBLIC_WEB_URL,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(
        `--${String(issue.path[0] ?? '').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} : ${issue.message}`,
      );
    }
    console.error('\nUsage : voir l’en-tête de src/cli/create-traiteur.ts (docs/deploiement.md).');
    process.exit(1);
  }
  return parsed.data;
}

/** Sortie de la commande (les journaux d'erreur passent par console.error). */
const print = (message: string): void => {
  process.stdout.write(`${message}
`);
};

async function main(): Promise<void> {
  const args = readArgs();
  const prisma = cliPrisma();
  try {
    // Matrice des permissions à jour (normalement déjà faite au déploiement)
    await syncPermissionCatalog(prisma);
    const { token, hash } = newLinkToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const traiteur = await prisma.$transaction(async (tx) => {
      if (await tx.traiteur.findUnique({ where: { slug: args.slug } })) {
        throw new Error(`Le slug « ${args.slug} » est déjà utilisé.`);
      }
      const created = await tx.traiteur.create({
        data: {
          slug: args.slug,
          name: args.name,
          email: args.email,
          phone: args.phone,
          city: args.city,
          plan: args.plan,
          status: 'ACTIVE',
          defaultLocale: args.locale,
        },
      });
      await tx.featureFlag.createMany({
        data: getDefaultFeatureFlags(args.plan).map((flag) => ({
          traiteurId: created.id,
          key: flag.key,
          enabled: flag.enabled,
        })),
      });
      const user =
        (await tx.user.findUnique({ where: { phone: args.adminPhone } })) ??
        (await tx.user.create({
          data: {
            phone: args.adminPhone,
            firstName: args.adminFirstName,
            lastName: args.adminLastName,
            locale: args.locale,
          },
        }));
      const membership = await tx.membership.create({
        data: {
          traiteurId: created.id,
          userId: user.id,
          role: 'ADMIN_TRAITEUR',
          status: 'INVITED',
          firstName: args.adminFirstName,
          lastName: args.adminLastName,
          locale: args.locale,
        },
      });
      await tx.staffInvitation.create({
        data: { traiteurId: created.id, membershipId: membership.id, tokenHash: hash, expiresAt },
      });
      await tx.auditLog.create({
        data: {
          traiteurId: created.id,
          action: 'traiteur.created',
          entityType: 'Traiteur',
          entityId: created.id,
          after: { slug: args.slug, plan: args.plan, adminMembershipId: membership.id },
        },
      });
      return created;
    });
    const url = `${args.webUrl.replace(/\/+$/, '')}/invitation/${token}`;
    print(`✓ Traiteur « ${traiteur.name} » créé (slug ${traiteur.slug}, offre ${traiteur.plan})`);
    print(`✓ Premier administrateur : ${args.adminFirstName} ${args.adminLastName}`);
    print('\nLien d’activation (valable 7 jours, à transmettre à l’administrateur) :');
    print(url);
    print(
      `\nÀ faire : TRAITEUR_SLUG=${traiteur.slug} dans le .env du serveur, puis redémarrer le service web.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
