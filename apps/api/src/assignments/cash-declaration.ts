import type { CashDeclaration, CollectionMethod } from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

/** Champs d'un encaissement déclaré à la livraison, lus pour l'affectation et la mission. */
export const declarationSelect = {
  id: true,
  amount: true,
  method: true,
  reference: true,
  collectedAt: true,
  remittedAt: true,
  voidedAt: true,
  voidReason: true,
  chequePhotoKey: true,
} satisfies Prisma.PaymentSelect;
type DeclarationRow = Prisma.PaymentGetPayload<{ select: typeof declarationSelect }>;

/** Déclarations d'une affectation, la plus récente d'abord (seule la première est montrée). */
export const latestDeclaration = {
  where: { collectedAt: { not: null } },
  select: declarationSelect,
  orderBy: { createdAt: 'desc' },
  take: 1,
} satisfies Prisma.StaffAssignment$paymentsArgs;

export function toDeclaration(row: DeclarationRow | undefined): CashDeclaration | null {
  if (!row?.collectedAt) return null;
  return {
    paymentId: row.id,
    amount: row.amount,
    method: row.method as CollectionMethod,
    reference: row.reference,
    collectedAt: row.collectedAt.toISOString(),
    // Annulée : refusée à la remise (ou annulée après coup) ; remise : validée avec son reçu
    status: row.voidedAt ? 'REJECTED' : row.remittedAt ? 'REMITTED' : 'PENDING',
    rejectReason: row.voidedAt ? row.voidReason : null,
    hasPhoto: row.chequePhotoKey !== null,
  };
}

/** Rôles sur l'événement qui peuvent encaisser à la livraison. */
export const CASH_ROLES = ['DRIVER', 'SUPERVISOR'];
