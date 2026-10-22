import { getDefaultFeatureFlags, type SubscriptionPlan } from '@traiteur/shared';

import { newLinkToken } from '../common/link-token';
import type { Prisma, Traiteur } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Lien d'activation du premier administrateur : 7 jours, comme les invitations du personnel. */
export const ADMIN_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProvisionInput {
  slug: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  plan: SubscriptionPlan;
  locale: 'fr' | 'ar';
  /** Essai (fin de période) ou actif d'emblée (traiteur pilote, commande serveur). */
  status: 'TRIAL' | 'ACTIVE';
  trialEndsAt: Date | null;
  admin: { phone: string; firstName: string; lastName: string };
}

export class ProvisionError extends Error {
  constructor(
    readonly code: 'SLUG_TAKEN' | 'ADMIN_IS_SUPER_ADMIN',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Création d'un traiteur, sans aucune donnée de démonstration : fonctionnalités de son offre,
 * premier administrateur invité (lien d'activation de 7 jours, sans mot de passe transmis).
 * Les listes par défaut (types d'événement, gammes…) sont créées par la base (trigger).
 * Partagée par la commande serveur create-traiteur et la console de la plateforme.
 */
export async function provisionTraiteur(
  tx: Tx,
  input: ProvisionInput,
): Promise<{ traiteur: Traiteur; membershipId: string; token: string; expiresAt: Date }> {
  if (await tx.traiteur.findUnique({ where: { slug: input.slug } })) {
    throw new ProvisionError('SLUG_TAKEN', `L’identifiant « ${input.slug} » est déjà utilisé.`);
  }
  const traiteur = await tx.traiteur.create({
    data: {
      slug: input.slug,
      name: input.name,
      email: input.email,
      phone: input.phone,
      city: input.city,
      plan: input.plan,
      status: input.status,
      trialEndsAt: input.status === 'TRIAL' ? input.trialEndsAt : null,
      defaultLocale: input.locale,
    },
  });
  await tx.featureFlag.createMany({
    data: getDefaultFeatureFlags(input.plan).map((flag) => ({
      traiteurId: traiteur.id,
      key: flag.key,
      enabled: flag.enabled,
    })),
  });
  // Un compte existant (client ailleurs, membre d'un autre traiteur) est réutilisé ;
  // jamais celui d'un super admin, dont l'accès est déjà total
  const existing = await tx.user.findUnique({ where: { phone: input.admin.phone } });
  if (existing?.isSuperAdmin) {
    throw new ProvisionError(
      'ADMIN_IS_SUPER_ADMIN',
      'Ce téléphone est celui d’un super admin : choisissez celui de l’administrateur du traiteur.',
    );
  }
  const user =
    existing ??
    (await tx.user.create({
      data: {
        phone: input.admin.phone,
        firstName: input.admin.firstName,
        lastName: input.admin.lastName,
        locale: input.locale,
      },
    }));
  const membership = await tx.membership.create({
    data: {
      traiteurId: traiteur.id,
      userId: user.id,
      role: 'ADMIN_TRAITEUR',
      status: 'INVITED',
      firstName: input.admin.firstName,
      lastName: input.admin.lastName,
      locale: input.locale,
    },
  });
  const { token, hash } = newLinkToken();
  const expiresAt = new Date(Date.now() + ADMIN_INVITATION_TTL_MS);
  await tx.staffInvitation.create({
    data: { traiteurId: traiteur.id, membershipId: membership.id, tokenHash: hash, expiresAt },
  });
  return { traiteur, membershipId: membership.id, token, expiresAt };
}
