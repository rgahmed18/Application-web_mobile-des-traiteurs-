import type { LocalizedText } from '@traiteur/shared';
import { z } from 'zod';

import { centsToInput, parseAmountToCents } from '@/lib/format/money';

/**
 * Conversions entre les valeurs saisies dans les formulaires (textes) et les données
 * attendues par l'API (schémas partagés). Les schémas de formulaire transforment ces valeurs
 * puis les valident avec le schéma partagé (.pipe) : mêmes règles qu'à l'API, mêmes chemins
 * d'erreur (name.fr, price...) que les champs du formulaire.
 */
export const localizedFormSchema = z.object({ fr: z.string(), ar: z.string() });
export type LocalizedFormValue = z.infer<typeof localizedFormSchema>;

export const EMPTY_LOCALIZED: LocalizedFormValue = { fr: '', ar: '' };

/** Texte bilingue : le français tel quel (validé ensuite), l'arabe seulement s'il est saisi. */
export function toLocalizedText(value: LocalizedFormValue): LocalizedText {
  const ar = value.ar.trim();
  return ar ? { fr: value.fr, ar } : { fr: value.fr };
}

/** Description facultative : null si les deux langues sont vides. */
export function toOptionalLocalizedText(value: LocalizedFormValue): LocalizedText | null {
  return value.fr.trim() === '' && value.ar.trim() === '' ? null : toLocalizedText(value);
}

export function fromLocalizedText(text: LocalizedText | null): LocalizedFormValue {
  return { fr: text?.fr ?? '', ar: text?.ar ?? '' };
}

/** Montant saisi (« 250,50 ») → centimes ; NaN si invalide (refusé par le schéma partagé). */
export function amountToCents(value: string): number {
  return parseAmountToCents(value) ?? Number.NaN;
}

export function centsToAmount(cents: number): string {
  return centsToInput(cents);
}

/** Entier saisi (« 50 ») ; NaN si vide ou invalide. */
export function toInteger(value: string): number {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Valeur du sélecteur de TVA : « default » = taux du traiteur (null pour l'API). */
export const DEFAULT_TAX_RATE = 'default';

export function toTaxRate(value: string): number | null {
  return value === DEFAULT_TAX_RATE ? null : Number(value);
}

export function fromTaxRate(taxRateBps: number | null): string {
  return taxRateBps === null ? DEFAULT_TAX_RATE : String(taxRateBps);
}
