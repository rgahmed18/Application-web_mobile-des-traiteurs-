import { type CatalogSettings, type Package, packageInputSchema } from '@traiteur/shared';
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

/** Formulaire d'une formule, validé par le schéma partagé packageInputSchema. */
export const packageFormSchema = z
  .object({
    name: localizedFormSchema,
    description: localizedFormSchema,
    pricePerPerson: z.string(),
    taxRateBps: z.string(),
    minGuests: z.string(),
    maxGuests: z.string(),
    imageKey: z.string().nullable(),
    isActive: z.boolean(),
    dishes: z.array(z.object({ dishId: z.string(), quantity: z.string() })),
  })
  .transform((values) => ({
    name: toLocalizedText(values.name),
    description: toOptionalLocalizedText(values.description),
    pricePerPerson: amountToCents(values.pricePerPerson),
    taxRateBps: toTaxRate(values.taxRateBps),
    minGuests: toInteger(values.minGuests),
    maxGuests: values.maxGuests.trim() === '' ? null : toInteger(values.maxGuests),
    imageKey: values.imageKey,
    isActive: values.isActive,
    dishes: values.dishes.map((line) => ({
      dishId: line.dishId,
      quantity: toInteger(line.quantity),
    })),
  }))
  .pipe(packageInputSchema);

export type PackageFormValues = z.input<typeof packageFormSchema>;

export const EMPTY_PACKAGE_FORM: PackageFormValues = {
  name: EMPTY_LOCALIZED,
  description: EMPTY_LOCALIZED,
  pricePerPerson: '',
  taxRateBps: DEFAULT_TAX_RATE,
  minGuests: '1',
  maxGuests: '',
  imageKey: null,
  isActive: true,
  dishes: [],
};

export function packageToFormValues(
  pkg: Package,
  settings: CatalogSettings,
  copySuffix?: string,
): PackageFormValues {
  const name = fromLocalizedText(pkg.name);
  return {
    name: copySuffix
      ? { fr: `${name.fr} ${copySuffix}`, ar: name.ar ? `${name.ar} ${copySuffix}` : '' }
      : name,
    description: fromLocalizedText(pkg.description),
    pricePerPerson: centsToAmount(
      settings.priceEntryMode === 'TTC' ? pkg.pricePerPersonTtc : pkg.pricePerPersonHt,
    ),
    taxRateBps: fromTaxRate(pkg.taxRateBps),
    minGuests: String(pkg.minGuests),
    maxGuests: pkg.maxGuests === null ? '' : String(pkg.maxGuests),
    imageKey: pkg.imageKey,
    isActive: pkg.isActive,
    // La copie reprend toute la composition
    dishes: pkg.dishes.map((line) => ({ dishId: line.dishId, quantity: String(line.quantity) })),
  };
}

export interface CompositionLine {
  /** Prix unitaire du plat dans le mode de saisie du traiteur (centimes). */
  unitPrice: number;
  quantity: string;
}

/**
 * Valeur des plats au détail, par personne (à titre indicatif) : somme des prix unitaires ×
 * quantités. Les quantités invalides en cours de saisie sont ignorées.
 */
export function compositionValue(lines: readonly CompositionLine[]): number {
  return lines.reduce((total, line) => {
    const quantity = toInteger(line.quantity);
    return Number.isFinite(quantity) ? total + line.unitPrice * quantity : total;
  }, 0);
}
