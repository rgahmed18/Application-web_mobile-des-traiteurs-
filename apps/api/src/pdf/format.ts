import {
  formatAmount,
  formatTaxRate,
  MONEY_CURRENCY_LABEL,
  MONEY_GROUP_SEPARATOR,
  utcToZoned,
} from '@traiteur/shared';

import { ltr } from './document-model';

export type DocLocale = 'fr' | 'ar';

/**
 * Mise en forme des documents PDF : identique à l'interface (format unique de packages/shared :
 * « 1 500,00 MAD », espace insécable entre les milliers, chiffres occidentaux dans les deux
 * langues), sans Intl pour un rendu déterministe.
 */
export { formatAmount };

/** « ⟦22 700,00⟧ MAD » ou « ⟦22 700,00⟧ د.م. » (la devise reste hors du passage gauche-droite). */
export function money(cents: number, locale: DocLocale): string {
  return `${ltr(formatAmount(cents))}${MONEY_GROUP_SEPARATOR}${MONEY_CURRENCY_LABEL[locale]}`;
}

/** Montant seul, pour une colonne de tableau. */
export function amount(cents: number): string {
  return ltr(formatAmount(cents));
}

/** « 2026-11-24 » → « ⟦24/11/2026⟧ » */
export function localDate(date: string): string {
  const [year, month, day] = date.split('-');
  return ltr(`${day ?? ''}/${month ?? ''}/${year ?? ''}`);
}

/** Instant UTC → date du traiteur « ⟦24/11/2026⟧ ». */
export function instantDate(instant: Date, timeZone: string): string {
  return localDate(utcToZoned(instant, timeZone).date);
}

export function rate(taxRateBps: number): string {
  return ltr(formatTaxRate(taxRateBps));
}

/** Première lettre en majuscule (montants en lettres en début de phrase). */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
