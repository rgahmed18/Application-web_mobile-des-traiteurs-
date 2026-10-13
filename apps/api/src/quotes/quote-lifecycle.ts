export { hashLinkToken, newLinkToken } from '../common/link-token';
import type { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

/**
 * Règles du cycle de vie des devis partagées avec le module commandes (sans dépendance de
 * module) : chaque fonction travaille dans la transaction de l'appelant.
 */

/** Révoque les liens encore actifs des devis donnés. */
export async function revokeLinks(
  db: Db,
  traiteurId: string,
  quoteIds: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  if (quoteIds.length === 0) return;
  await db.quoteLink.updateMany({
    where: { traiteurId, quoteId: { in: [...quoteIds] }, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Lignes de la commande modifiées : les devis envoyés ou acceptés ne correspondent plus à la
 * commande. Ils passent « Remplacé » (un nouveau devis est nécessaire) et leurs liens sont
 * révoqués ; une commande confirmée le reste. Retourne les références remplacées.
 */
export async function supersedeQuotesOnOrderChange(
  db: Db,
  traiteurId: string,
  orderId: string,
): Promise<string[]> {
  const quotes = await db.quote.findMany({
    where: { traiteurId, orderId, status: { in: ['SENT', 'ACCEPTED'] } },
    select: { id: true, reference: true, version: true },
  });
  if (quotes.length === 0) return [];
  const now = new Date();
  const ids = quotes.map((quote) => quote.id);
  await db.quote.updateMany({
    where: { traiteurId, id: { in: ids } },
    data: {
      status: 'SUPERSEDED',
      supersededReason: 'ORDER_CHANGED',
      supersededAt: now,
      availabilityPending: false,
    },
  });
  await revokeLinks(db, traiteurId, ids, now);
  return quotes.map((quote) => `${quote.reference} v${quote.version}`);
}

/**
 * Le traiteur a tranché sur la date d'un devis accepté (commande confirmée, annulée ou remise
 * en attente) : l'alerte « date à confirmer » disparaît.
 */
export async function clearAvailabilityPending(
  db: Db,
  traiteurId: string,
  orderId: string,
): Promise<void> {
  await db.quote.updateMany({
    where: { traiteurId, orderId, availabilityPending: true },
    data: { availabilityPending: false },
  });
}

/** Reste-t-il un devis en cours (envoyé, ou accepté en attente de date) pour la commande ? */
export async function hasOpenQuote(db: Db, traiteurId: string, orderId: string): Promise<boolean> {
  const count = await db.quote.count({
    where: {
      traiteurId,
      orderId,
      OR: [{ status: 'SENT' }, { status: 'ACCEPTED', availabilityPending: true }],
    },
  });
  return count > 0;
}
