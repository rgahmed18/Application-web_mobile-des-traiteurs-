import { z } from 'zod';

import { paginatedSchema } from '../catalog/catalog.schemas';
import {
  eventTypeSchema,
  lineItemTypeSchema,
  ORDER_STATUSES,
  orderStatusSchema,
  type OrderStatus,
} from '../enums';
import { localizedTextSchema } from '../i18n/localized-text';
import { MAX_TAX_RATE_BPS, PRICE_MODES } from '../money/money';
import { cancellationRefundSchema } from '../payments/payment.schemas';
import { localDateSchema, localTimeSchema } from '../time/zoned';
import { lineLabelInputSchema, lineLabelSchema } from './line-label';

// ─────────────────────────── Saisies ───────────────────────────

const centsSchema = z.number().int().min(0).max(1_000_000_000);

/** Références au catalogue d'une ligne : une seule, celle de son type (aucune pour CUSTOM). */
export const LINE_REF_FIELDS = [
  'dishId',
  'packageId',
  'extraServiceId',
  'equipmentId',
  'buffetId',
] as const;
export type LineRefField = (typeof LINE_REF_FIELDS)[number];
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
    equipmentId: z.uuid().nullable().default(null),
    buffetId: z.uuid().nullable().default(null),
    /** Libellé dans toutes les langues disponibles (copie du catalogue ou saisie libre). */
    label: lineLabelInputSchema,
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
      EQUIPMENT: 'equipmentId',
      BUFFET: 'buffetId',
      CUSTOM: null,
    } as const;
    const key = expected[line.itemType];
    for (const field of LINE_REF_FIELDS) {
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

/** Délai du matériel d'une commande, en heures (null : réglage du traiteur). */
const equipmentHoursSchema = z.number().int().min(0).max(240).nullable().default(null);

/**
 * Stock de matériel dépassé sur la période d'occupation : le traiteur peut confirmer quand même,
 * avec un motif tracé (sous-location, matériel du client…).
 */
const stockOverrideSchema = optionalText(500).default(null);

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
  /** Installation avant le début et retour après la fin, pour le stock de matériel. */
  equipmentSetupHours: equipmentHoursSchema,
  equipmentReturnHours: equipmentHoursSchema,
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
    stockOverrideReason: stockOverrideSchema,
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
    stockOverrideReason: stockOverrideSchema,
  })
  .superRefine(refineSchedule);
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const orderTransitionSchema = z.object({
  to: orderStatusSchema,
  reason: optionalText(500).default(null),
  version: z.number().int().min(1),
  forceAvailability: z.boolean().default(false),
  stockOverrideReason: stockOverrideSchema,
  /**
   * Annulation d'une commande payée : montant remboursé (le reste est conservé comme frais
   * d'annulation). Obligatoire dès qu'un paiement a été encaissé.
   */
  refund: cancellationRefundSchema.nullable().default(null),
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
  /** Paiement : reste à payer (commandes fermes) ou en retard sur l'échéancier. */
  payment: z.enum(['unpaid', 'overdue']).optional(),
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
  equipmentId: z.uuid().nullable(),
  buffetId: z.uuid().nullable(),
  label: lineLabelSchema,
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
  /** Nom du type d'événement dans la liste du traiteur. */
  eventTypeName: localizedTextSchema,
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
  /** Payé net, reste à payer et montant en retard (échéancier). */
  paid: z.number().int(),
  remaining: z.number().int(),
  overdueAmount: z.number().int(),
  /** Un membre ne peut pas venir, ou n'a pas confirmé 48 h avant l'événement. */
  staffAlert: z.enum(['DECLINED', 'UNCONFIRMED']).nullable(),
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
  equipmentSetupHours: z.number().int().nullable(),
  equipmentReturnHours: z.number().int().nullable(),
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

/**
 * Réponse d'un changement de statut pour un utilisateur sans orders.read (livreur) : le
 * strict nécessaire pour enchaîner les étapes, sans prix, notes ni coordonnées du client.
 */
export const orderStatusUpdateSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderStatusSchema,
  version: z.number().int(),
});
export type OrderStatusUpdate = z.infer<typeof orderStatusUpdateSchema>;

/** Réponse de POST /orders/:id/transitions : commande complète, ou minimum selon les droits. */
export const orderTransitionResultSchema = z.union([orderSchema, orderStatusUpdateSchema]);
export type OrderTransitionResult = z.infer<typeof orderTransitionResultSchema>;

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
  /** Jour de fermeture hebdomadaire du traiteur. */
  closed: z.boolean(),
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

/** Matériel en manque sur la période d'occupation de la commande. */
export const equipmentShortageSchema = z.object({
  equipmentId: z.uuid(),
  label: localizedTextSchema,
  requested: z.number().int(),
  stock: z.number().int(),
  /** Déjà réservé par les autres commandes fermes de la période. */
  reserved: z.number().int(),
  /** Commandes en attente de la période (indicatif). */
  pending: z.number().int(),
  remaining: z.number().int(),
});
export type EquipmentShortage = z.infer<typeof equipmentShortageSchema>;

/** Détail de l'erreur 409 EQUIPMENT_STOCK_CONFLICT (le traiteur peut confirmer avec un motif). */
export const equipmentStockConflictSchema = z.object({
  code: z.literal('EQUIPMENT_STOCK_CONFLICT'),
  message: z.string(),
  shortages: z.array(equipmentShortageSchema),
});
export type EquipmentStockConflict = z.infer<typeof equipmentStockConflictSchema>;

/** Détail de l'erreur 409 ORDER_VERSION_CONFLICT. */
export const versionConflictSchema = z.object({
  code: z.literal('ORDER_VERSION_CONFLICT'),
  message: z.string(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.iso.datetime().nullable(),
});
