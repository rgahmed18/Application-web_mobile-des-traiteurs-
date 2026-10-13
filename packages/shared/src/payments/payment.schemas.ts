import { z } from 'zod';

import { localizedTextSchema } from '../i18n/localized-text';
import { MAX_TAX_RATE_BPS } from '../money/money';
import { localDateSchema } from '../time/zoned';

// ─────────────────────────── Énumérations ───────────────────────────

/** Modes d'encaissement saisis au back-office (le paiement en ligne viendra plus tard). */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_TYPES = ['DEPOSIT', 'BALANCE', 'FULL', 'REFUND'] as const;
export const paymentTypeSchema = z.enum(PAYMENT_TYPES);
export type PaymentType = z.infer<typeof paymentTypeSchema>;

export const INSTALLMENT_KINDS = ['DEPOSIT', 'BALANCE', 'FULL'] as const;

const centsSchema = z.number().int().min(1).max(10_000_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);

// ─────────────────────────── Saisies ───────────────────────────

/** Encaissement manuel (espèces, virement, chèque, carte sur TPE). */
export const paymentInputSchema = z.object({
  amount: centsSchema,
  method: paymentMethodSchema,
  /** N° de chèque, référence du virement, n° de transaction TPE… */
  reference: optionalText(100),
  /** Jour de l'encaissement (fuseau du traiteur), jamais dans le futur. */
  paidOn: localDateSchema,
  notes: optionalText(500),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** Remboursement : même saisie, montant au plus égal au payé net. */
export const refundInputSchema = paymentInputSchema;
export type RefundInput = z.infer<typeof refundInputSchema>;

/** Annulation d'un encaissement saisi par erreur (le reçu reste numéroté, marqué annulé). */
export const voidPaymentSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

export const depositUpdateSchema = z.object({
  depositAmount: z.number().int().min(0).max(10_000_000_000),
});
export type DepositUpdateInput = z.infer<typeof depositUpdateSchema>;

/**
 * Remboursement saisi à l'annulation d'une commande payée : le reste du payé est conservé comme
 * frais d'annulation (montant 0 accepté : rien n'est remboursé).
 */
export const cancellationRefundSchema = z.object({
  amount: z.number().int().min(0).max(10_000_000_000),
  method: paymentMethodSchema,
  reference: optionalText(100),
  paidOn: localDateSchema,
});
export type CancellationRefund = z.infer<typeof cancellationRefundSchema>;

// ─────────────────────────── Réponses ───────────────────────────

export const installmentSchema = z.object({
  kind: z.enum(INSTALLMENT_KINDS),
  amount: z.number().int(),
  dueDate: z.string().nullable(),
  paid: z.number().int(),
  remaining: z.number().int(),
  overdue: z.boolean(),
});

export const paymentScheduleSchema = z.object({
  installments: z.array(installmentSchema),
  totalTtc: z.number().int(),
  paid: z.number().int(),
  remaining: z.number().int(),
  overdueAmount: z.number().int(),
  overdueSince: z.string().nullable(),
});

export const paymentSchema = z.object({
  id: z.uuid(),
  type: paymentTypeSchema,
  method: paymentMethodSchema,
  amount: z.number().int(),
  reference: z.string().nullable(),
  /** Jour de l'encaissement (fuseau du traiteur). */
  paidOn: z.string(),
  receiptNumber: z.string().nullable(),
  voided: z.boolean(),
  voidReason: z.string().nullable(),
  recordedBy: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Encaissé à la livraison : déclaré par le livreur, pas encore remis (ne compte pas). */
  pendingRemittance: z.boolean(),
  collectedBy: z.string().nullable(),
  /** Jour de la remise à l'administrateur (encaissement à la livraison validé). */
  remittedOn: z.string().nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const orderPaymentsSchema = z.object({
  schedule: paymentScheduleSchema,
  /** Acompte figé (commande confirmée) ou prévu. */
  depositAmount: z.number().int(),
  depositLocked: z.boolean(),
  received: z.number().int(),
  refunded: z.number().int(),
  /** Conservé à l'annulation (payé non remboursé). */
  cancellationFee: z.number().int(),
  payments: z.array(paymentSchema),
});
export type OrderPayments = z.infer<typeof orderPaymentsSchema>;

/** Réponse d'un téléchargement : URL signée, valable quelques minutes. */
export const downloadSchema = z.object({ url: z.url(), fileName: z.string() });
export type Download = z.infer<typeof downloadSchema>;

// ─────────────────────────── Réglages de facturation ───────────────────────────

export const CREDIT_NOTE_NUMBERINGS = ['SEPARATE', 'SHARED'] as const;

const nullableText = (max: number) => z.string().trim().max(max).nullable();

/** Réglages « Documents et paiements » du traiteur (Paramètres). */
export const billingSettingsInputSchema = z.object({
  depositPercentBps: z.number().int().min(0).max(10_000),
  balanceDueDays: z.number().int().min(0).max(90),
  quoteValidityDays: z.number().int().min(1).max(365),
  /** TVA des frais d'annulation facturés (null : taux par défaut du traiteur). */
  cancellationFeeTaxRateBps: z.number().int().min(0).max(MAX_TAX_RATE_BPS).nullable(),
  /** Avoirs : séquence propre (AV-…) ou partagée avec les factures. */
  creditNoteNumbering: z.enum(CREDIT_NOTE_NUMBERINGS),
  legalName: nullableText(150),
  legalForm: nullableText(60),
  /** Capital social en dirhams. */
  shareCapital: z.number().int().min(0).max(10_000_000_000).nullable(),
  ice: z
    .string()
    .trim()
    .regex(/^\d{15}$/, 'ICE : 15 chiffres')
    .nullable(),
  rcNumber: nullableText(30),
  rcCourt: nullableText(60),
  taxId: nullableText(30),
  patenteNumber: nullableText(30),
  cnssNumber: nullableText(30),
  legalAddress: nullableText(300),
  bankName: nullableText(100),
  rib: nullableText(40),
  invoiceFooter: nullableText(300),
  /** Conditions imprimées sur les devis (acompte, annulation…), en français et en arabe. */
  quoteTerms: localizedTextSchema.nullable(),
  /** Conditions de paiement imprimées sur les factures. */
  paymentTerms: localizedTextSchema.nullable(),
});
export type BillingSettingsInput = z.infer<typeof billingSettingsInputSchema>;

export const billingSettingsSchema = billingSettingsInputSchema.extend({
  isVatRegistered: z.boolean(),
  defaultTaxRateBps: z.number().int(),
  hasLogo: z.boolean(),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
