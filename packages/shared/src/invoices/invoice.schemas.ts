import { z } from 'zod';

import { paginatedSchema } from '../catalog/catalog.schemas';
import { localDateSchema } from '../time/zoned';

// ─────────────────────────── Énumérations ───────────────────────────

/** Facture ou avoir (montants négatifs, référence la facture d'origine). */
export const INVOICE_TYPES = ['INVOICE', 'CREDIT_NOTE'] as const;
export const invoiceTypeSchema = z.enum(INVOICE_TYPES);
export type InvoiceType = z.infer<typeof invoiceTypeSchema>;

/**
 * Nature : facture de la commande entière, d'acompte, de solde (lignes de la commande moins les
 * acomptes facturés) ou de frais d'annulation. Un avoir garde la nature de sa facture d'origine.
 */
export const INVOICE_KINDS = ['TOTAL', 'DEPOSIT', 'BALANCE', 'CANCELLATION_FEE'] as const;
export const invoiceKindSchema = z.enum(INVOICE_KINDS);
export type InvoiceKind = z.infer<typeof invoiceKindSchema>;

// ─────────────────────────── Saisies ───────────────────────────

/** Émission d'une facture : la date d'émission est toujours celle du jour (imposée par la base). */
export const invoiceIssueSchema = z.object({
  kind: invoiceKindSchema,
  notes: z.string().trim().max(500).nullable().default(null),
});
export type InvoiceIssueInput = z.infer<typeof invoiceIssueSchema>;

/** Avoir total d'une facture (annulation, erreur) : motif obligatoire, imprimé sur l'avoir. */
export const creditNoteInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CreditNoteInput = z.infer<typeof creditNoteInputSchema>;

export const INVOICE_EXPORT_FORMATS = ['xlsx', 'csv'] as const;

export const invoiceListQuerySchema = z.object({
  /** Jours d'émission inclus (fuseau du traiteur). */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  type: invoiceTypeSchema.optional(),
  /** N° de facture, référence de commande, client ou ICE. */
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceExportQuerySchema = invoiceListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(INVOICE_EXPORT_FORMATS) });
export type InvoiceExportQuery = z.infer<typeof invoiceExportQuerySchema>;

// ─────────────────────────── Réponses ───────────────────────────

const taxBreakdownSchema = z.array(
  z.object({
    taxRateBps: z.number().int(),
    baseHt: z.number().int(),
    taxAmount: z.number().int(),
  }),
);

export const invoiceSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  type: invoiceTypeSchema,
  kind: invoiceKindSchema,
  number: z.string(),
  issuedAt: z.iso.datetime(),
  /** Jour d'émission (fuseau du traiteur). */
  issuedOn: z.string(),
  dueDate: z.string().nullable(),
  clientName: z.string(),
  clientIce: z.string().nullable(),
  /** Montants en centimes, négatifs pour un avoir. */
  totalHt: z.number().int(),
  totalTax: z.number().int(),
  totalTtc: z.number().int(),
  taxBreakdown: taxBreakdownSchema,
  /** Avoir : facture d'origine et motif. */
  originalNumber: z.string().nullable(),
  reason: z.string().nullable(),
  /** Facture : somme des avoirs émis sur elle (≤ 0). */
  creditedTtc: z.number().int(),
  locale: z.enum(['fr', 'ar']),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoicePageSchema = paginatedSchema(invoiceSchema);
export type InvoicePage = z.infer<typeof invoicePageSchema>;

/**
 * Factures d'une commande et ce qu'il est possible d'émettre ensuite (montant TTC de chaque
 * facture possible, null si elle ne l'est pas).
 */
export const orderInvoicingSchema = z.object({
  invoices: z.array(invoiceSchema),
  available: z.object({
    TOTAL: z.number().int().nullable(),
    DEPOSIT: z.number().int().nullable(),
    BALANCE: z.number().int().nullable(),
    CANCELLATION_FEE: z.number().int().nullable(),
  }),
  /** Net facturé (factures − avoirs). */
  invoicedTtc: z.number().int(),
});
export type OrderInvoicing = z.infer<typeof orderInvoicingSchema>;
