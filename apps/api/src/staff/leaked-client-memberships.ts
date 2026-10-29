import type { AuditAction } from '@traiteur/shared';

import type { PrismaClient } from '../generated/prisma/client';

/**
 * Inscriptions « client » créées par erreur : avant la correction de la connexion à l'espace de
 * gestion, un membre du personnel d'un traiteur qui se connectait au back-office d'un autre
 * traiteur y était inscrit automatiquement comme CLIENT. Utilisé par la commande serveur
 * leaked-client-memberships (src/cli).
 */
export interface LeakedMembership {
  membershipId: string;
  traiteurId: string;
  traiteurName: string;
  userId: string;
  userName: string;
  phone: string;
  createdAt: Date;
  /** Traiteurs où ce compte fait partie du personnel. */
  staffOf: string[];
}

/**
 * Inscriptions CLIENT d'un compte qui fait partie du personnel d'un AUTRE traiteur, créées après
 * son entrée dans ce personnel, et sans aucune trace d'activité de client : ni commande, ni
 * adresse, ni conversation, ni message, ni avis. Une inscription utilisée n'est jamais touchée.
 */
export async function findLeakedClientMemberships(
  prisma: PrismaClient,
): Promise<LeakedMembership[]> {
  const candidates = await prisma.membership.findMany({
    where: {
      role: 'CLIENT',
      clientOrders: { none: {} },
      addresses: { none: {} },
      conversations: { none: {} },
      messagesSent: { none: {} },
      reviews: { none: {} },
      user: { memberships: { some: { role: { not: 'CLIENT' } } } },
    },
    select: {
      id: true,
      traiteurId: true,
      createdAt: true,
      traiteur: { select: { name: true } },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          memberships: {
            where: { role: { not: 'CLIENT' } },
            select: { traiteurId: true, createdAt: true, traiteur: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return candidates.flatMap((membership) => {
    const staff = membership.user.memberships.filter(
      (staffMembership) =>
        staffMembership.traiteurId !== membership.traiteurId &&
        staffMembership.createdAt <= membership.createdAt,
    );
    if (staff.length === 0) return [];
    return [
      {
        membershipId: membership.id,
        traiteurId: membership.traiteurId,
        traiteurName: membership.traiteur.name,
        userId: membership.user.id,
        userName: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
        phone: membership.user.phone,
        createdAt: membership.createdAt,
        staffOf: staff.map((staffMembership) => staffMembership.traiteur.name),
      },
    ];
  });
}

/** Supprime les inscriptions listées (re-vérifiées dans la transaction) et les trace. */
export async function removeLeakedClientMemberships(
  prisma: PrismaClient,
  leaked: readonly LeakedMembership[],
): Promise<number> {
  let removed = 0;
  for (const entry of leaked) {
    await prisma.$transaction(async (tx) => {
      // Toujours sans activité au moment de la suppression (sinon on la garde)
      const { count } = await tx.membership.deleteMany({
        where: {
          id: entry.membershipId,
          role: 'CLIENT',
          clientOrders: { none: {} },
          addresses: { none: {} },
          conversations: { none: {} },
          messagesSent: { none: {} },
          reviews: { none: {} },
        },
      });
      if (count === 0) return;
      await tx.auditLog.create({
        data: {
          traiteurId: entry.traiteurId,
          actorUserId: null,
          actorRole: null,
          action: 'membership.leaked_client_removed' satisfies AuditAction,
          entityType: 'Membership',
          entityId: entry.membershipId,
          before: {
            role: 'CLIENT',
            userId: entry.userId,
            createdAt: entry.createdAt.toISOString(),
          },
          after: {
            reason:
              'Inscription client créée par erreur à la connexion au back-office (membre du personnel d’un autre traiteur)',
          },
        },
      });
      removed += 1;
    });
  }
  return removed;
}
