import { type Buffet, buffetInputSchema, type CatalogSettings } from '@traiteur/shared';
import { z } from 'zod';

import {
  amountToCents,
  centsToAmount,
  DEFAULT_TAX_RATE,
  EMPTY_LOCALIZED,
  fromLocalizedText,
  fromTaxRate,
  localizedFormSchema,
  toInteger,
  toLocalizedText,
  toOptionalLocalizedText,
  toTaxRate,
} from '../forms/form-values';

/** Formulaire d'un buffet, validé par le schéma partagé buffetInputSchema. */
export const buffetFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    typeId: z.string(),
    rangeId: z.string(),
    pricingUnit: z.enum(['PER_PERSON', 'FLAT']),
    price: z.string(),
    taxRateBps: z.string(),
    minGuests: z.string(),
    imageKey: z.string().nullable(),
    isActive: z.boolean(),
    dishes: z.array(z.object({ dishId: z.string(), quantity: z.string() })),
    /** Éléments hors catalogue ; une ligne vide est ignorée. */
    freeItems: z.array(localizedFormSchema),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    typeId: values.typeId === '' ? null : values.typeId,
    rangeId: values.rangeId === '' ? null : values.rangeId,
    pricingUnit: values.pricingUnit,
    price: amountToCents(values.price),
    taxRateBps: toTaxRate(values.taxRateBps),
    minGuests: toInteger(values.minGuests),
    imageKey: values.imageKey,
    isActive: values.isActive,
    dishes: values.dishes.map((line) => ({
      dishId: line.dishId,
      quantity: toInteger(line.quantity),
    })),
    freeItems: values.freeItems
      .filter((item) => item.fr.trim() !== '' || item.ar.trim() !== '')
      .map(toLocalizedText),
  }))
  .pipe(buffetInputSchema);

export type BuffetFormValues = z.input<typeof buffetFormSchema>;

export const EMPTY_BUFFET_FORM: BuffetFormValues = {
  name: EMPTY_LOCALIZED,
  description: EMPTY_LOCALIZED,
  typeId: '',
  rangeId: '',
  pricingUnit: 'PER_PERSON',
  price: '',
  taxRateBps: DEFAULT_TAX_RATE,
  minGuests: '1',
  imageKey: null,
  isActive: true,
  dishes: [],
  freeItems: [],
};

export function buffetToFormValues(buffet: Buffet, settings: CatalogSettings): BuffetFormValues {
  return {
    name: fromLocalizedText(buffet.name),
    description: fromLocalizedText(buffet.description),
    typeId: buffet.type?.id ?? '',
    rangeId: buffet.range?.id ?? '',
    pricingUnit: buffet.pricingUnit,
    price: centsToAmount(settings.priceEntryMode === 'TTC' ? buffet.priceTtc : buffet.priceHt),
    taxRateBps: fromTaxRate(buffet.taxRateBps),
    minGuests: String(buffet.minGuests),
    imageKey: buffet.imageKey,
    isActive: buffet.isActive,
    dishes: buffet.dishes.map((line) => ({ dishId: line.dishId, quantity: String(line.quantity) })),
    freeItems: buffet.freeItems.map(fromLocalizedText),
  };
}
