import { type CatalogSettings, type Equipment, equipmentInputSchema } from '@traiteur/shared';
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

/**
 * Formulaire d'un article de matériel : valeurs saisies (textes), transformées puis validées par
 * le schéma partagé equipmentInputSchema — exactement les règles appliquées par l'API.
 */
export const equipmentFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    categoryId: z.string(),
    rangeId: z.string(),
    price: z.string(),
    replacementPrice: z.string(),
    taxRateBps: z.string(),
    stockQuantity: z.string(),
    imageKey: z.string().nullable(),
    isActive: z.boolean(),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    categoryId: values.categoryId === '' ? null : values.categoryId,
    rangeId: values.rangeId === '' ? null : values.rangeId,
    price: amountToCents(values.price),
    // Vide : pas de facturation du remplacement
    replacementPrice:
      values.replacementPrice.trim() === '' ? 0 : amountToCents(values.replacementPrice),
    taxRateBps: toTaxRate(values.taxRateBps),
    stockQuantity: toInteger(values.stockQuantity),
    imageKey: values.imageKey,
    isActive: values.isActive,
  }))
  .pipe(equipmentInputSchema);

export type EquipmentFormValues = z.input<typeof equipmentFormSchema>;

export const EMPTY_EQUIPMENT_FORM: EquipmentFormValues = {
  name: EMPTY_LOCALIZED,
  description: EMPTY_LOCALIZED,
  categoryId: '',
  rangeId: '',
  price: '',
  replacementPrice: '',
  taxRateBps: DEFAULT_TAX_RATE,
  stockQuantity: '0',
  imageKey: null,
  isActive: true,
};

/** Valeurs à partir d'un article : prix affichés dans le mode de saisie du traiteur. */
export function equipmentToFormValues(
  item: Equipment,
  settings: CatalogSettings,
): EquipmentFormValues {
  const ttc = settings.priceEntryMode === 'TTC';
  return {
    name: fromLocalizedText(item.name),
    description: fromLocalizedText(item.description),
    categoryId: item.category?.id ?? '',
    rangeId: item.range?.id ?? '',
    price: centsToAmount(ttc ? item.priceTtc : item.priceHt),
    replacementPrice: centsToAmount(ttc ? item.replacementPriceTtc : item.replacementPriceHt),
    taxRateBps: fromTaxRate(item.taxRateBps),
    stockQuantity: String(item.stockQuantity),
    imageKey: item.imageKey,
    isActive: item.isActive,
  };
}
