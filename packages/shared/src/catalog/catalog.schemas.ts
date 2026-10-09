import { z } from 'zod';

import { localizedTextSchema } from '../i18n/localized-text';
import { MAX_TAX_RATE_BPS } from '../money/money';

// ─────────────────────────── Énumérations ───────────────────────────

export const DISH_UNITS = ['PER_PERSON', 'PER_PIECE', 'PER_PLATTER', 'PER_KG'] as const;
export const dishUnitSchema = z.enum(DISH_UNITS);
export type DishUnit = z.infer<typeof dishUnitSchema>;

export const PRICING_UNITS = ['FLAT', 'PER_PERSON', 'PER_HOUR', 'PER_UNIT'] as const;
export const pricingUnitSchema = z.enum(PRICING_UNITS);
export type PricingUnit = z.infer<typeof pricingUnitSchema>;

/** Les 14 allergènes à déclaration obligatoire (règlement européen, repris au Maroc). */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export const allergenSchema = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof allergenSchema>;

/** Taux de TVA proposés dans les formulaires (Maroc), en points de base. */
export const COMMON_TAX_RATES_BPS = [0, 700, 1000, 1400, 2000] as const;

// ─────────────────────────── Champs communs ───────────────────────────

/** Montant en centimes, saisi dans le mode de prix du traiteur (HT ou TTC). */
const centsSchema = z.number().int().min(0).max(100_000_000);

/** Taux propre à l'article ; null = taux par défaut du traiteur. */
const taxRateSchema = z.number().int().min(0).max(MAX_TAX_RATE_BPS).nullable();

const optionalDescriptionSchema = localizedTextSchema.nullable();

/**
 * Clé d'une photo traitée par l'API (« traiteurs/<id>/catalog/<uuid> »), obtenue après
 * l'envoi : jamais une URL libre.
 */
export const imageKeySchema = z
  .string()
  .regex(/^traiteurs\/[0-9a-f-]{36}\/catalog\/[0-9a-f-]{36}$/, 'Photo invalide');

// ─────────────────────────── Saisies ───────────────────────────

export const categoryInputSchema = z.object({
  name: localizedTextSchema,
  description: optionalDescriptionSchema,
  isActive: z.boolean(),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categoryReorderSchema = z.object({
  /** Identifiants des catégories dans le nouvel ordre. */
  ids: z.array(z.uuid()).min(1).max(500),
});
export type CategoryReorderInput = z.infer<typeof categoryReorderSchema>;

export const dishInputSchema = z.object({
  name: localizedTextSchema,
  description: optionalDescriptionSchema,
  categoryId: z.uuid().nullable(),
  /** Prix unitaire dans le mode de saisie du traiteur ; l'autre prix est calculé par l'API. */
  price: centsSchema,
  taxRateBps: taxRateSchema,
  unit: dishUnitSchema,
  minQuantity: z.number().int().min(1).max(100_000),
  allergens: z.array(allergenSchema).max(ALLERGENS.length),
  imageKey: imageKeySchema.nullable(),
  isAvailable: z.boolean(),
});
export type DishInput = z.infer<typeof dishInputSchema>;

export const packageDishInputSchema = z.object({
  dishId: z.uuid(),
  /** Portions par personne (ou nombre de pièces par personne). */
  quantity: z.number().int().min(1).max(1_000),
});

export const packageInputSchema = z
  .object({
    name: localizedTextSchema,
    description: optionalDescriptionSchema,
    /** Prix par personne dans le mode de saisie du traiteur. */
    pricePerPerson: centsSchema,
    taxRateBps: taxRateSchema,
    minGuests: z.number().int().min(1).max(100_000),
    maxGuests: z.number().int().min(1).max(100_000).nullable(),
    imageKey: imageKeySchema.nullable(),
    isActive: z.boolean(),
    dishes: z.array(packageDishInputSchema).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    if (value.maxGuests !== null && value.maxGuests < value.minGuests) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxGuests'],
        message: 'Le maximum doit être supérieur ou égal au minimum',
        params: { i18n: 'maxGuestsBelowMin' },
      });
    }
    const seen = new Set<string>();
    value.dishes.forEach((dish, index) => {
      if (seen.has(dish.dishId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['dishes', index, 'dishId'],
          message: 'Plat en double dans la formule',
          params: { i18n: 'duplicateDish' },
        });
      }
      seen.add(dish.dishId);
    });
  });
export type PackageInput = z.infer<typeof packageInputSchema>;

export const extraServiceInputSchema = z.object({
  name: localizedTextSchema,
  description: optionalDescriptionSchema,
  price: centsSchema,
  taxRateBps: taxRateSchema,
  pricingUnit: pricingUnitSchema,
  isActive: z.boolean(),
});
export type ExtraServiceInput = z.infer<typeof extraServiceInputSchema>;

// ─────────────────────────── Listes ───────────────────────────

export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const dishListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  /** true : uniquement les éléments archivés ; absent ou false : les éléments actifs. */
  archived: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type DishListQuery = z.infer<typeof dishListQuerySchema>;

export const packageListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  archived: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PackageListQuery = z.infer<typeof packageListQuerySchema>;

export const archivedQuerySchema = z.object({ archived: booleanQuery });

// ─────────────────────────── Réponses ───────────────────────────

const timestampsSchema = {
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const catalogSettingsSchema = z.object({
  priceEntryMode: z.enum(['HT', 'TTC']),
  isVatRegistered: z.boolean(),
  defaultTaxRateBps: z.number().int(),
  currency: z.string(),
  timezone: z.string(),
});
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  dishCount: z.number().int(),
  ...timestampsSchema,
});
export type Category = z.infer<typeof categorySchema>;

/** Présence dans une commande ou un devis : l'élément ne peut alors qu'être archivé. */
const usageSchema = { inUse: z.boolean() };

export const dishSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  categoryId: z.uuid().nullable(),
  priceHt: z.number().int(),
  priceTtc: z.number().int(),
  taxRateBps: z.number().int().nullable(),
  /** Taux réellement appliqué (taux de l'article, du traiteur, ou 0 si non assujetti). */
  effectiveTaxRateBps: z.number().int(),
  unit: dishUnitSchema,
  minQuantity: z.number().int(),
  allergens: z.array(allergenSchema),
  imageKey: z.string().nullable(),
  isAvailable: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  ...usageSchema,
  ...timestampsSchema,
});
export type Dish = z.infer<typeof dishSchema>;

export const packageDishSchema = z.object({
  dishId: z.uuid(),
  quantity: z.number().int(),
  sortOrder: z.number().int(),
  dish: dishSchema.pick({
    id: true,
    name: true,
    priceHt: true,
    priceTtc: true,
    unit: true,
    imageKey: true,
    isAvailable: true,
    archivedAt: true,
  }),
});

export const packageSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  pricePerPersonHt: z.number().int(),
  pricePerPersonTtc: z.number().int(),
  taxRateBps: z.number().int().nullable(),
  effectiveTaxRateBps: z.number().int(),
  minGuests: z.number().int(),
  maxGuests: z.number().int().nullable(),
  imageKey: z.string().nullable(),
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  dishes: z.array(packageDishSchema),
  ...usageSchema,
  ...timestampsSchema,
});
export type Package = z.infer<typeof packageSchema>;

export const extraServiceSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  priceHt: z.number().int(),
  priceTtc: z.number().int(),
  taxRateBps: z.number().int().nullable(),
  effectiveTaxRateBps: z.number().int(),
  pricingUnit: pricingUnitSchema,
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  ...usageSchema,
  ...timestampsSchema,
});
export type ExtraService = z.infer<typeof extraServiceSchema>;

export function paginatedSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export const dishPageSchema = paginatedSchema(dishSchema);
export type DishPage = z.infer<typeof dishPageSchema>;
export const packagePageSchema = paginatedSchema(packageSchema);
export type PackagePage = z.infer<typeof packagePageSchema>;
