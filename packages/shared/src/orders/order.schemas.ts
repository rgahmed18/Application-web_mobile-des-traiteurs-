import { z } from 'zod';

import { paginatedSchema } from '../catalog/catalog.schemas';
import {
  eventTypeSchema,
  lineItemTypeSchema,
  ORDER_STATUSES,
  orderStatusSchema,
  type OrderStatus,
} from '../enums';
import { MAX_TAX_RATE_BPS, PRICE_MODES } from '../money/money';
import { localDateSchema, localTimeSchema } from '../time/zoned';

// ─────────────────────────── Saisies ───────────────────────────

const centsSchema = z.number().int().min(0).max(1_000_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

/**
 * Ligne de commande. `unitPrice` et `discount` sont exprimés dans le mode de prix de la commande
 * (TTC ou HT) : c'est ce montant qui fait foi, l'autre est dérivé par l'API.
 */
export const orderLineInputSchema = z
  .object({
    itemType: lineItemTypeSchema,
    dishId: z.uuid().nullable().default(null),
    packageId: z.uuid().nullable().default(null),
    extraServiceId: z.uuid().nullable().default(null),
    label: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(100_000),
    unitPrice: centsSchema,
    discount: centsSchema.default(0),
    taxRateBps: z.number().int().min(0).max(MAX_TAX_RATE_BPS),
    /** Quantité liée au nombre d'invités (formule, plat ou service par personne). */
    perPerson: z.boolean(),
    notes: optionalText(500).default(null),
  })
  .superRefine((line, ctx) => {
    const expected = {
      DISH: 'dishId',
      PACKAGE: 'packageId',
      EXTRA_SERVICE: 'extraServiceId',
      CUSTOM: null,
    } as const;
    const key = expected[line.itemType];
    for (const field of ['dishId', 'packageId', 'extraServiceId'] as const) {
      if (field === key && !line[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Élément du catalogue requis' });
      }
      if (field !== key && line[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Élément incompatible avec le type',
        });
      }
    }
    if (line.discount > line.unitPrice * line.quantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['discount'],
        message: 'La remise dépasse le montant de la ligne',
        params: { i18n: 'discountTooHigh' },
      });
    }
  });
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

const orderFieldsSchema = z.object({
  /** Membership CLIENT du traiteur. */
  clientId: z.uuid(),
  eventType: eventTypeSchema,
  /** Jour et heures dans le fuseau du traiteur. */
  eventDate: localDateSchema,
  startTime: localTimeSchema,
  endTime: localTimeSchema.nullable(),
  /** Fin le lendemain (soirée après minuit). Ne compte que dans la capacité du jour de début. */
  endsNextDay: z.boolean(),
  guestCount: z.number().int().min(1).max(10_000),
  venueName: optionalText(150),
  venueAddress: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  notes: optionalText(2000),
  internalNotes: optionalText(2000),
  lines: z.array(orderLineInputSchema).max(200),
});

/** La fin de l'événement doit suivre son début. */
function refineSchedule(
  value: { startTime: string; endTime: string | null; endsNextDay: boolean },
  ctx: z.RefinementCtx,
): void {
  if (value.endTime === null) {
    if (value.endsNextDay) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Heure de fin requise' });
    }
    return;
  }
  if (!value.endsNextDay && value.endTime <= value.startTime) {
    ctx.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'La fin doit être après le début',
      params: { i18n: 'endBeforeStart' },
    });
  }
}

/** Statut à la création : brouillon, en attente, ou confirmée directement (commande au téléphone). */
export const ORDER_CREATE_STATUSES = ['DRAFT', 'PENDING', 'CONFIRMED'] as const;

export const orderCreateSchema = orderFieldsSchema
  .extend({
    status: z.enum(ORDER_CREATE_STATUSES),
    /** Le traiteur a confirmé passer outre une date bloquée ou une capacité atteinte. */
    forceAvailability: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    refineSchedule(value, ctx);
    if (value.status !== 'DRAFT' && value.lines.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Ajoutez au moins une ligne',
        params: { i18n: 'linesRequired' },
      });
    }
  });
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderUpdateSchema = orderFieldsSchema
  .extend({
    /** Version lue : refus (409) si la commande a été modifiée entre-temps. */
    version: z.number().int().min(1),
    /** Motif, obligatoire pour modifier une commande confirmée (date, invités, lignes...). */
    reason: optionalText(500).default(null),
    forceAvailability: z.boolean().default(false),
  })
  .superRefine(refineSchedule);
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const orderTransitionSchema = z.object({
  to: orderStatusSchema,
  reason: optionalText(500).default(null),
  version: z.number().int().min(1),
  forceAvailability: z.boolean().default(false),
});
export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;

/** Liste de statuts en paramètre d'URL : « PENDING,CONFIRMED ». */
const statusListQuery = z
  .string()
  .optional()
  .transform((value, ctx): OrderStatus[] | undefined => {
    if (!value) return undefined;
    const items = value.split(',').map((item) => item.trim());
    const invalid = items.filter((item) => !(ORDER_STATUSES as readonly string[]).includes(item));
    if (invalid.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Statut inconnu : ${invalid.join(', ')}` });
      return z.NEVER;
    }
    return items as OrderStatus[];
  });

export const ORDER_SORTS = ['eventDate', 'createdAt', 'reference'] as const;

export const orderListQuerySchema = z.object({
  /** Référence (CMD-2026-00012) ou client (nom, téléphone). */
  search: z.string().trim().max(100).optional(),
  status: statusListQuery,
  eventType: eventTypeSchema.optional(),
  /** Période sur la date de l'événement (jours du traiteur, bornes incluses). */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  clientId: z.uuid().optional(),
  /** Commandes fermes dont la date est passée (carte « À clôturer »). */
  toClose: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(ORDER_SORTS).default('eventDate'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const availabilityQuerySchema = z.object({
  date: localDateSchema,
  /** Commande à exclure du décompte (modification de sa date). */
  excludeOrderId: z.uuid().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// ─────────────────────────── Réponses ───────────────────────────

export const priceModeSchema = z.enum(PRICE_MODES);

export const orderLineSchema = z.object({
  id: z.uuid(),
  itemType: lineItemTypeSchema,
  dishId: z.uuid().nullable(),
  packageId: z.uuid().nullable(),
  extraServiceId: z.uuid().nullable(),
  label: z.string(),
  quantity: z.number().int(),
  /** Prix unitaire et remise dans le mode de la commande (montants saisis). */
  unitPrice: z.number().int(),
  discount: z.number().int(),
  unitPriceHt: z.number().int(),
  unitPriceTtc: z.number().int(),
  taxRateBps: z.number().int(),
  totalHt: z.number().int(),
  taxAmount: z.number().int(),
  totalTtc: z.number().int(),
  perPerson: z.boolean(),
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderClientSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
});

export const orderSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderStatusSchema,
  eventType: eventTypeSchema,
  /** Jour et heures dans le fuseau du traiteur. */
  eventDate: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  endsNextDay: z.boolean(),
  eventStart: z.iso.datetime(),
  client: orderClientSchema,
  guestCount: z.number().int(),
  venueName: z.string().nullable(),
  city: z.string(),
  priceMode: priceModeSchema,
  totalTtc: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const taxBreakdownSchema = z.array(
  z.object({ taxRateBps: z.number().int(), baseHt: z.number().int(), taxAmount: z.number().int() }),
);

export const orderSchema = orderSummarySchema.extend({
  version: z.number().int(),
  eventEnd: z.iso.datetime().nullable(),
  venueAddress: z.string(),
  notes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  totalHt: z.number().int(),
  totalTax: z.number().int(),
  taxBreakdown: taxBreakdownSchema,
  depositAmount: z.number().int(),
  confirmedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancellationReason: z.string().nullable(),
  lines: z.array(orderLineSchema),
  updatedAt: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderPageSchema = paginatedSchema(orderSummarySchema);
export type OrderPage = z.infer<typeof orderPageSchema>;

export const ORDER_HISTORY_KINDS = ['CREATED', 'STATUS', 'UPDATED'] as const;

export const orderHistoryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(ORDER_HISTORY_KINDS),
  at: z.iso.datetime(),
  actorName: z.string().nullable(),
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema.nullable(),
  reason: z.string().nullable(),
  /** Groupes de champs modifiés (UPDATED) : schedule, venue, guests, lines, notes... */
  changes: z.array(z.string()),
});
export type OrderHistoryEntry = z.infer<typeof orderHistoryEntrySchema>;

export const availabilitySchema = z.object({
  date: z.string(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Capacité du traiteur (null = pas de limite). */
  capacity: z.number().int().nullable(),
  /** Commandes fermes du jour (comptent dans la capacité). */
  firmCount: z.number().int(),
  /** Commandes en attente du jour (indicatif). */
  pendingCount: z.number().int(),
  full: z.boolean(),
});
export type Availability = z.infer<typeof availabilitySchema>;

/** Détail de l'erreur 409 AVAILABILITY_CONFLICT (le traiteur peut forcer). */
export const availabilityConflictSchema = z.object({
  code: z.literal('AVAILABILITY_CONFLICT'),
  message: z.string(),
  availability: availabilitySchema,
});

/** Détail de l'erreur 409 ORDER_VERSION_CONFLICT. */
export const versionConflictSchema = z.object({
  code: z.literal('ORDER_VERSION_CONFLICT'),
  message: z.string(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.iso.datetime().nullable(),
});
