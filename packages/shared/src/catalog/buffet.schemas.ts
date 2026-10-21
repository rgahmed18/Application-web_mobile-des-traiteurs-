import { z } from 'zod';

import { localizedTextSchema } from '../i18n/localized-text';
import {
  booleanQuery,
  catalogListRefSchema,
  centsSchema,
  imageKeySchema,
  packageDishInputSchema,
  packageDishSchema,
  paginatedSchema,
  taxRateSchema,
} from './catalog.schemas';

/** Tarification d'un buffet : par personne (× invités) ou forfait. */
export const BUFFET_PRICINGS = ['PER_PERSON', 'FLAT'] as const;
export const buffetPricingSchema = z.enum(BUFFET_PRICINGS);
export type BuffetPricing = z.infer<typeof buffetPricingSchema>;

/**
 * Buffet (marocain, oriental, sucré, thé…) : type et gamme des listes du traiteur, prix par
 * personne ou forfait dans le mode de saisie du traiteur, composition en plats du catalogue
 * (quantités décomptées sur le bon de préparation) et en éléments libres FR/AR.
 */
export const buffetInputSchema = z
  .object({
    name: localizedTextSchema,
    description: localizedTextSchema.nullable(),
    typeId: z.uuid().nullable(),
    rangeId: z.uuid().nullable(),
    pricingUnit: buffetPricingSchema,
    price: centsSchema,
    taxRateBps: taxRateSchema,
    minGuests: z.number().int().min(1).max(100_000),
    imageKey: imageKeySchema.nullable(),
    isActive: z.boolean(),
    /** Plats du catalogue : portions par personne (ou au total pour un forfait). */
    dishes: z.array(packageDishInputSchema).max(100),
    /** Éléments hors catalogue (ex. « Fruits secs », « Msemen et beghrir »). */
    freeItems: z.array(localizedTextSchema).max(50),
  })
  .superRefine((value, ctx) => {
    if (value.dishes.length + value.freeItems.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['dishes'],
        message: 'Ajoutez au moins un plat ou un élément',
        params: { i18n: 'buffetEmpty' },
      });
    }
    const seen = new Set<string>();
    value.dishes.forEach((dish, index) => {
      if (seen.has(dish.dishId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['dishes', index, 'dishId'],
          message: 'Plat en double dans le buffet',
          params: { i18n: 'duplicateDish' },
        });
      }
      seen.add(dish.dishId);
    });
  });
export type BuffetInput = z.infer<typeof buffetInputSchema>;

export const buffetListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  typeId: z.uuid().optional(),
  rangeId: z.uuid().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  archived: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type BuffetListQuery = z.infer<typeof buffetListQuerySchema>;

export const buffetSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  type: catalogListRefSchema.nullable(),
  range: catalogListRefSchema.nullable(),
  pricingUnit: buffetPricingSchema,
  priceHt: z.number().int(),
  priceTtc: z.number().int(),
  taxRateBps: z.number().int().nullable(),
  effectiveTaxRateBps: z.number().int(),
  minGuests: z.number().int(),
  imageKey: z.string().nullable(),
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  dishes: z.array(packageDishSchema),
  freeItems: z.array(localizedTextSchema),
  /** Déjà sur une commande ou un devis : seule l'archive est possible. */
  inUse: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Buffet = z.infer<typeof buffetSchema>;

export const buffetPageSchema = paginatedSchema(buffetSchema);
export type BuffetPage = z.infer<typeof buffetPageSchema>;
