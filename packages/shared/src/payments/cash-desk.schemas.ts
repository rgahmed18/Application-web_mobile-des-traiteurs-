import { z } from 'zod';

import { collectionMethodSchema } from '../staff/assignment.schemas';

/**
 * Caisse livreurs : encaissements déclarés à la livraison et pas encore remis à l'administrateur.
 * Ils ne comptent dans les encaissements qu'une fois remis (validés), avec leur reçu.
 */

export const cashDeskItemSchema = z.object({
  paymentId: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  eventDate: z.string(),
  clientName: z.string(),
  amount: z.number().int(),
  method: collectionMethodSchema,
  reference: z.string().nullable(),
  collectedAt: z.iso.datetime(),
  hasPhoto: z.boolean(),
  /** Montant prévu sur l'affectation (écart signalé s'il diffère). */
  expectedAmount: z.number().int().nullable(),
});
export type CashDeskItem = z.infer<typeof cashDeskItemSchema>;

export const cashDeskSchema = z.object({
  total: z.number().int(),
  drivers: z.array(
    z.object({
      membershipId: z.uuid().nullable(),
      name: z.string(),
      phone: z.string().nullable(),
      total: z.number().int(),
      cash: z.number().int(),
      cheques: z.number().int(),
      items: z.array(cashDeskItemSchema),
    }),
  ),
});
export type CashDesk = z.infer<typeof cashDeskSchema>;

/** Refus d'une déclaration (montant non reçu, erreur…) : motif obligatoire. */
export const cashRejectSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type CashRejectInput = z.infer<typeof cashRejectSchema>;
