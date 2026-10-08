import {
  allergenSchema,
  type CatalogSettings,
  type Dish,
  dishInputSchema,
  dishUnitSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import {
  amountToCents,
  centsToAmount,
  EMPTY_LOCALIZED,
  fromLocalizedText,
  fromTaxRate,
  DEFAULT_TAX_RATE,
  localizedFormSchema,
  toInteger,
  toLocalizedText,
  toOptionalLocalizedText,
  toTaxRate,
} from '../forms/form-values';

/**
 * Formulaire d'un plat : valeurs saisies (textes), transformées puis validées par le schéma
 * partagé dishInputSchema — exactement les règles appliquées par l'API.
 */
export const dishFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    categoryId: z.string(),
    price: z.string(),
    taxRateBps: z.string(),
    unit: dishUnitSchema,
    minQuantity: z.string(),
    allergens: z.array(allergenSchema),
    imageKey: z.string().nullable(),
    isAvailable: z.boolean(),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    categoryId: values.categoryId === '' ? null : values.categoryId,
    price: amountToCents(values.price),
    taxRateBps: toTaxRate(values.taxRateBps),
    unit: values.unit,
    minQuantity: toInteger(values.minQuantity),
    allergens: values.allergens,
    imageKey: values.imageKey,
    isAvailable: values.isAvailable,
  }))
  .pipe(dishInputSchema);

export type DishFormValues = z.input<typeof dishFormSchema>;

export const EMPTY_DISH_FORM: DishFormValues = {
  name: EMPTY_LOCALIZED,
  description: EMPTY_LOCALIZED,
  categoryId: '',
  price: '',
  taxRateBps: DEFAULT_TAX_RATE,
  unit: 'PER_PERSON',
  minQuantity: '1',
  allergens: [],
  imageKey: null,
  isAvailable: true,
};

/**
 * Valeurs du formulaire à partir d'un plat existant (modification) ou à dupliquer.
 * Le prix affiché est celui que le traiteur saisit : TTC ou HT selon son mode.
 */
export function dishToFormValues(
  dish: Dish,
  settings: CatalogSettings,
  copySuffix?: string,
): DishFormValues {
  const name = fromLocalizedText(dish.name);
  return {
    name: copySuffix
      ? { fr: `${name.fr} ${copySuffix}`, ar: name.ar ? `${name.ar} ${copySuffix}` : '' }
      : name,
    description: fromLocalizedText(dish.description),
    categoryId: dish.categoryId ?? '',
    price: centsToAmount(settings.priceEntryMode === 'TTC' ? dish.priceTtc : dish.priceHt),
    taxRateBps: fromTaxRate(dish.taxRateBps),
    unit: dish.unit,
    minQuantity: String(dish.minQuantity),
    allergens: dish.allergens,
    imageKey: dish.imageKey,
    isAvailable: dish.isAvailable,
  };
}
