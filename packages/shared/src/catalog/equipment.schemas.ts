import { z } from 'zod';

import type { OrderStatus } from '../enums';
import { localizedTextSchema } from '../i18n/localized-text';
import {
  booleanQuery,
  catalogListRefSchema,
  centsSchema,
  imageKeySchema,
  paginatedSchema,
  taxRateSchema,
} from './catalog.schemas';

/**
 * Matériel de fête loué avec les prestations (chaises, tables, nappes, vaisselle, éclairage…) :
 * prix de location par unité et prix de remplacement (manquant ou cassé) saisis dans le mode du
 * traiteur, quantité en stock, catégorie et gamme des listes du traiteur.
 */
export const equipmentInputSchema = z.object({
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  categoryId: z.uuid().nullable(),
  rangeId: z.uuid().nullable(),
  /** Location par unité, dans le mode de saisie du traiteur (HT ou TTC). */
  price: centsSchema,
  /** Remplacement par unité (manquant ou cassé), même mode ; 0 = non facturé. */
  replacementPrice: centsSchema,
  taxRateBps: taxRateSchema,
  stockQuantity: z.number().int().min(0).max(1_000_000),
  imageKey: imageKeySchema.nullable(),
  isActive: z.boolean(),
});
export type EquipmentInput = z.infer<typeof equipmentInputSchema>;

export const equipmentListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  rangeId: z.uuid().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  archived: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type EquipmentListQuery = z.infer<typeof equipmentListQuerySchema>;

export const equipmentSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  category: catalogListRefSchema.nullable(),
  range: catalogListRefSchema.nullable(),
  priceHt: z.number().int(),
  priceTtc: z.number().int(),
  replacementPriceHt: z.number().int(),
  replacementPriceTtc: z.number().int(),
  taxRateBps: z.number().int().nullable(),
  effectiveTaxRateBps: z.number().int(),
  stockQuantity: z.number().int(),
  imageKey: z.string().nullable(),
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** Déjà sur une commande : seule l'archive est possible. */
  inUse: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Equipment = z.infer<typeof equipmentSchema>;

export const equipmentPageSchema = paginatedSchema(equipmentSchema);
export type EquipmentPage = z.infer<typeof equipmentPageSchema>;

// ─────────────────────────── Disponibilité ───────────────────────────

/** Délais d'occupation par défaut (heures) : installation avant, retour après l'événement. */
export const DEFAULT_EQUIPMENT_SETUP_HOURS = 12;
export const DEFAULT_EQUIPMENT_RETURN_HOURS = 24;
export const equipmentHoursSchema = z.number().int().min(0).max(240);

/** Commandes fermes : leur matériel est déduit du stock. */
export const EQUIPMENT_FIRM_STATUSES = [
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];
/** Commandes en attente : affichées à part (« +60 en attente »), jamais déduites du stock. */
export const EQUIPMENT_PENDING_STATUSES = [
  'PENDING',
  'QUOTED',
] as const satisfies readonly OrderStatus[];

export interface OccupationPeriod {
  start: Date;
  end: Date;
}

/**
 * Période d'occupation du matériel d'un événement : du début moins le délai d'installation à
 * la fin (le début si l'heure de fin est inconnue) plus le délai de retour.
 */
export function occupationPeriod(
  eventStart: Date,
  eventEnd: Date | null,
  setupHours: number,
  returnHours: number,
): OccupationPeriod {
  const hour = 3_600_000;
  return {
    start: new Date(eventStart.getTime() - setupHours * hour),
    end: new Date((eventEnd ?? eventStart).getTime() + returnHours * hour),
  };
}

/**
 * Même période en heures locales du traiteur (« 2026-10-24T17:30 »), pour interroger la
 * disponibilité pendant la saisie d'une commande. Calcul sur l'heure locale : exact au Maroc
 * (UTC+0 toute l'année), à une heure près autour d'un changement d'heure ailleurs. Une période
 * vide (aucun délai, pas d'heure de fin) dure une minute.
 */
export function localOccupationPeriod(
  event: { eventDate: string; startTime: string; endTime: string | null; endsNextDay: boolean },
  setupHours: number,
  returnHours: number,
): { start: string; end: string } {
  const minute = 60_000;
  const at = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);
  const start = at(event.eventDate, event.startTime);
  const end =
    event.endTime === null
      ? start
      : at(event.eventDate, event.endTime) + (event.endsNextDay ? 86_400_000 : 0);
  const from = start - setupHours * 60 * minute;
  const to = Math.max(end + returnHours * 60 * minute, from + minute);
  const format = (value: number) => new Date(value).toISOString().slice(0, 16);
  return { start: format(from), end: format(to) };
}

/** Deux périodes se chevauchent si l'une commence avant la fin de l'autre (bornes exclues). */
export function periodsOverlap(a: OccupationPeriod, b: OccupationPeriod): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Date et heure locales du traiteur : « 2026-10-24T17:30 ». */
const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Date et heure invalides');

/** Disponibilité sur une période (heures locales du traiteur), hors une commande éventuelle. */
export const equipmentAvailabilityQuerySchema = z
  .object({
    start: localDateTimeSchema,
    end: localDateTimeSchema,
    /** Commande en cours de saisie : ses propres lignes ne comptent pas. */
    excludeOrderId: z.uuid().optional(),
  })
  .refine((value) => value.end > value.start, {
    path: ['end'],
    message: 'La fin doit être après le début',
  });
export type EquipmentAvailabilityQuery = z.infer<typeof equipmentAvailabilityQuerySchema>;

export const equipmentAvailabilitySchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  items: z.array(
    z.object({
      equipmentId: z.uuid(),
      stock: z.number().int(),
      /** Quantités des commandes fermes dont l'occupation chevauche la période. */
      reserved: z.number().int(),
      /** Quantités des commandes en attente (non déduites). */
      pending: z.number().int(),
      /** Stock moins réservé (négatif : dépassement). */
      remaining: z.number().int(),
    }),
  ),
});
export type EquipmentAvailability = z.infer<typeof equipmentAvailabilitySchema>;
