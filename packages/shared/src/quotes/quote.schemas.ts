import { z } from 'zod';

import { eventTypeSchema } from '../enums';
import { localizedTextSchema } from '../i18n/localized-text';
import { localDateSchema } from '../time/zoned';

// ─────────────────────────── Énumérations ───────────────────────────

/**
 * Cycle d'un devis : brouillon → envoyé → accepté, refusé ou expiré. « Remplacé » : une version
 * plus récente a été envoyée, ou les lignes de la commande ont changé après l'envoi.
 */
export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/** Accord en ligne (lien du devis) ou enregistré par le traiteur. */
export const ACCEPTANCE_MODES = ['ONLINE', 'PHONE', 'PAPER', 'OTHER'] as const;
export const acceptanceModeSchema = z.enum(ACCEPTANCE_MODES);
export type AcceptanceMode = z.infer<typeof acceptanceModeSchema>;

export const MANUAL_ACCEPTANCE_MODES = ['PHONE', 'PAPER', 'OTHER'] as const;

export const SUPERSEDED_REASONS = ['NEW_VERSION', 'ORDER_CHANGED'] as const;

const documentLocaleSchema = z.enum(['fr', 'ar']);

// ─────────────────────────── Saisies (back-office) ───────────────────────────

/** Nouvelle version d'un devis à partir des lignes actuelles de la commande. */
export const quoteCreateSchema = z.object({
  /** Validité en jours (défaut : réglage du traiteur). */
  validityDays: z.number().int().min(1).max(365).nullable().default(null),
  /** Langue du PDF et de la page publique (défaut : langue du client). */
  locale: documentLocaleSchema.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>;

/** Modification d'un brouillon. */
export const quoteUpdateSchema = z.object({
  validUntil: localDateSchema,
  locale: documentLocaleSchema,
  notes: z.string().trim().max(1000).nullable(),
});
export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>;

/**
 * Accord enregistré par le traiteur (accord téléphonique, devis papier signé…). Champs d'un
 * envoi multipart : la pièce jointe (scan, photo) est facultative.
 */
export const manualAcceptanceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mode: z.enum(MANUAL_ACCEPTANCE_MODES),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value ? value : null)),
});
export type ManualAcceptanceInput = z.infer<typeof manualAcceptanceSchema>;

// ─────────────────────────── Saisies (page publique) ───────────────────────────

export const publicAcceptSchema = z.object({
  /** Nom saisi par le client : tracé avec l'heure, l'IP et le navigateur. */
  name: z.string().trim().min(2).max(120),
  /** Case « J'accepte le devis et ses conditions » cochée. */
  consent: z.literal(true),
});
export type PublicAcceptInput = z.infer<typeof publicAcceptSchema>;

export const publicRejectSchema = z.object({
  reason: z.string().trim().max(1000).nullable().default(null),
});
export type PublicRejectInput = z.infer<typeof publicRejectSchema>;

// ─────────────────────────── Réponses ───────────────────────────

export const quoteAcceptanceSchema = z.object({
  mode: acceptanceModeSchema,
  name: z.string(),
  at: z.iso.datetime(),
  note: z.string().nullable(),
  /** Membre de l'équipe ayant enregistré l'accord (accord manuel). */
  recordedBy: z.string().nullable(),
  hasAttachment: z.boolean(),
});

export const quoteSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  reference: z.string(),
  version: z.number().int(),
  status: quoteStatusSchema,
  locale: documentLocaleSchema,
  /** Dernier jour de validité (fuseau du traiteur). */
  validUntil: z.string(),
  notes: z.string().nullable(),
  totalHt: z.number().int(),
  totalTax: z.number().int(),
  totalTtc: z.number().int(),
  sentAt: z.iso.datetime().nullable(),
  acceptance: quoteAcceptanceSchema.nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  /** Accepté alors que la date est bloquée ou complète : le traiteur doit confirmer. */
  availabilityPending: z.boolean(),
  supersededReason: z.enum(SUPERSEDED_REASONS).nullable(),
  /** Lien public actif (non révoqué, non expiré). */
  linkActive: z.boolean(),
  linkViews: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Quote = z.infer<typeof quoteSchema>;

/** Lien sécurisé à partager (affiché une seule fois : seul son empreinte est conservée). */
export const quoteLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type QuoteLink = z.infer<typeof quoteLinkSchema>;

export const quoteSendResultSchema = z.object({ quote: quoteSchema, link: quoteLinkSchema });
export type QuoteSendResult = z.infer<typeof quoteSendResultSchema>;

/** Devis tel que le client le voit (page publique, sans connexion). */
export const publicQuoteSchema = z.object({
  reference: z.string(),
  version: z.number().int(),
  status: quoteStatusSchema,
  locale: documentLocaleSchema,
  traiteur: z.object({ name: z.string(), phone: z.string(), email: z.string() }),
  clientName: z.string(),
  event: z.object({
    type: eventTypeSchema,
    /** Nom du type, figé à l'émission du devis. */
    typeName: localizedTextSchema,
    date: z.string(),
    startTime: z.string(),
    endTime: z.string().nullable(),
    endsNextDay: z.boolean(),
    guestCount: z.number().int(),
    venue: z.string(),
  }),
  priceMode: z.enum(['HT', 'TTC']),
  lines: z.array(
    z.object({
      label: z.string(),
      quantity: z.number().int(),
      unitPrice: z.number().int(),
      discount: z.number().int(),
      taxRateBps: z.number().int(),
      total: z.number().int(),
    }),
  ),
  totalHt: z.number().int(),
  totalTax: z.number().int(),
  totalTtc: z.number().int(),
  taxBreakdown: z.array(
    z.object({
      taxRateBps: z.number().int(),
      baseHt: z.number().int(),
      taxAmount: z.number().int(),
    }),
  ),
  amountInWords: z.string(),
  validUntil: z.string(),
  terms: z.string().nullable(),
  depositAmount: z.number().int(),
  balanceDueDate: z.string().nullable(),
  acceptance: z.object({ name: z.string(), at: z.iso.datetime() }).nullable(),
  availabilityPending: z.boolean(),
});
export type PublicQuote = z.infer<typeof publicQuoteSchema>;
