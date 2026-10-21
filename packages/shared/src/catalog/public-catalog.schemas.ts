import { z } from 'zod';

import { eventTypeSchema } from '../enums';
import { localizedTextSchema } from '../i18n/localized-text';

/**
 * Catalogue public d'un traiteur, en lecture seule, pour son futur site client : menus et
 * formules, buffets et matériel actifs, prix TTC, photos, textes FR/AR. Jamais de stock, de prix
 * de remplacement, de prix HT ni d'élément archivé ou désactivé.
 */

/** Code d'une liste du traiteur (type d'événement, gamme…) : « WEDDING », « PREMIUM ». */
const listCodeSchema = eventTypeSchema;

export const publicListItemSchema = z.object({
  code: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
});
export type PublicListItem = z.infer<typeof publicListItemSchema>;

/** Choix proposés au visiteur : types d'événement et gammes, dans l'ordre du traiteur. */
export const publicCatalogOptionsSchema = z.object({
  traiteur: z.object({ slug: z.string(), name: z.string() }),
  currency: z.string(),
  eventTypes: z.array(publicListItemSchema),
  ranges: z.array(publicListItemSchema),
});
export type PublicCatalogOptions = z.infer<typeof publicCatalogOptionsSchema>;

export const publicCatalogQuerySchema = z.object({
  /** Menus prévus pour ce type d'événement (ou pour tous les types). */
  eventType: listCodeSchema.optional(),
  /** Menus, buffets et matériel de cette gamme. */
  range: listCodeSchema.optional(),
});
export type PublicCatalogQuery = z.infer<typeof publicCatalogQuerySchema>;

/** Plat d'une composition : nom et quantité seulement. */
const publicDishSchema = z.object({
  name: localizedTextSchema,
  quantity: z.number().int(),
});

const publicItemBase = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  /** Photo publique (null si aucune). */
  imageUrl: z.url().nullable(),
  range: publicListItemSchema.nullable(),
});

export const publicMenuSchema = publicItemBase.extend({
  pricePerPersonTtc: z.number().int(),
  minGuests: z.number().int(),
  maxGuests: z.number().int().nullable(),
  /** Types d'événement prévus (vide : tous). */
  eventTypes: z.array(z.string()),
  dishes: z.array(publicDishSchema),
});
export type PublicMenu = z.infer<typeof publicMenuSchema>;

export const publicBuffetSchema = publicItemBase.extend({
  type: publicListItemSchema.nullable(),
  pricingUnit: z.enum(['PER_PERSON', 'FLAT']),
  priceTtc: z.number().int(),
  minGuests: z.number().int(),
  dishes: z.array(publicDishSchema),
  freeItems: z.array(localizedTextSchema),
});
export type PublicBuffet = z.infer<typeof publicBuffetSchema>;

export const publicEquipmentSchema = publicItemBase.extend({
  category: publicListItemSchema.nullable(),
  /** Prix de location TTC par unité. */
  priceTtc: z.number().int(),
});
export type PublicEquipment = z.infer<typeof publicEquipmentSchema>;

export const publicCatalogSchema = z.object({
  currency: z.string(),
  menus: z.array(publicMenuSchema),
  buffets: z.array(publicBuffetSchema),
  equipment: z.array(publicEquipmentSchema),
});
export type PublicCatalog = z.infer<typeof publicCatalogSchema>;
