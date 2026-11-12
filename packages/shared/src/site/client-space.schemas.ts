import { z } from 'zod';

import { localizedTextSchema } from '../i18n/localized-text';
import { lineLabelSchema } from '../orders/line-label';
import { orderStatusSchema } from '../enums';

/**
 * Espace du client sur le site du traiteur : ses demandes et commandes, devis, factures, reçus
 * et paiements, chez CE traiteur seulement. Jamais de note interne, de note de service, de
 * personnel affecté ni de nom d'employé : l'historique dit « vous » ou le nom du traiteur.
 */

const quoteStatusSchema = z.enum(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']);

export const clientOrderSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderStatusSchema,
  eventTypeName: localizedTextSchema,
  /** Jour et heure de début dans le fuseau du traiteur. */
  eventDate: z.string(),
  startTime: z.string(),
  guestCount: z.number().int(),
  city: z.string(),
  totalTtc: z.number().int(),
  source: z.enum(['BACKOFFICE', 'ONLINE']),
  /** Un devis attend la réponse du client. */
  quoteToAnswer: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ClientOrderSummary = z.infer<typeof clientOrderSummarySchema>;

export const clientQuoteSummarySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  reference: z.string(),
  version: z.number().int(),
  status: quoteStatusSchema,
  totalTtc: z.number().int(),
  /** Dernier jour de validité (fuseau du traiteur). */
  validUntil: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
});
export type ClientQuoteSummary = z.infer<typeof clientQuoteSummarySchema>;

export const clientInvoiceSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  number: z.string(),
  type: z.enum(['INVOICE', 'CREDIT_NOTE']),
  kind: z.enum(['TOTAL', 'DEPOSIT', 'BALANCE', 'CANCELLATION_FEE']),
  totalTtc: z.number().int(),
  issuedAt: z.iso.datetime(),
});
export type ClientInvoice = z.infer<typeof clientInvoiceSchema>;

export const clientPaymentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  type: z.enum(['DEPOSIT', 'BALANCE', 'FULL', 'REFUND']),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE']),
  amount: z.number().int(),
  paidAt: z.iso.datetime().nullable(),
  /** Reçu numéroté (téléchargeable), absent pour un encaissement non validé. */
  receiptNumber: z.string().nullable(),
  voided: z.boolean(),
});
export type ClientPayment = z.infer<typeof clientPaymentSchema>;

/** Échéance à venir : acompte, solde ou totalité. */
export const clientInstallmentSchema = z.object({
  kind: z.enum(['DEPOSIT', 'BALANCE', 'FULL']),
  amount: z.number().int(),
  remaining: z.number().int(),
  /** null : due à la confirmation. */
  dueDate: z.string().nullable(),
  overdue: z.boolean(),
});
export type ClientInstallment = z.infer<typeof clientInstallmentSchema>;

export const clientOrderSchema = clientOrderSummarySchema.extend({
  endTime: z.string().nullable(),
  endsNextDay: z.boolean(),
  venueName: z.string().nullable(),
  venueAddress: z.string(),
  notes: z.string().nullable(),
  lines: z.array(
    z.object({
      label: lineLabelSchema,
      quantity: z.number().int(),
      unitPriceTtc: z.number().int(),
      totalTtc: z.number().int(),
    }),
  ),
  /** Historique des statuts : par le client (« vous ») ou par le traiteur. */
  history: z.array(
    z.object({
      at: z.iso.datetime(),
      fromStatus: orderStatusSchema.nullable(),
      toStatus: orderStatusSchema,
      byClient: z.boolean(),
    }),
  ),
  quotes: z.array(clientQuoteSummarySchema),
  invoices: z.array(clientInvoiceSchema),
  payments: z.array(clientPaymentSchema),
  paid: z.number().int(),
  remaining: z.number().int(),
  installments: z.array(clientInstallmentSchema),
  /** Annulation possible par le client (demande encore en attente). */
  cancellable: z.boolean(),
});
export type ClientOrder = z.infer<typeof clientOrderSchema>;

/** Accueil de l'espace : demandes en cours, devis à traiter, prochaine échéance. */
export const clientDashboardSchema = z.object({
  activeOrders: z.array(clientOrderSummarySchema),
  quotesToAnswer: z.array(clientQuoteSummarySchema),
  nextPayment: clientInstallmentSchema
    .extend({ orderId: z.uuid(), orderReference: z.string() })
    .nullable(),
});
export type ClientDashboard = z.infer<typeof clientDashboardSchema>;

/** Refus d'un devis depuis l'espace : motif facultatif. */
export const clientQuoteRejectSchema = z.object({
  reason: z.string().trim().max(500).nullable().default(null),
});
export type ClientQuoteRejectInput = z.infer<typeof clientQuoteRejectSchema>;
