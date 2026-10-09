import { formatTaxRate, utcToZoned } from '@traiteur/shared';

import { ltr } from './document-model';

export type DocLocale = 'fr' | 'ar';

/**
 * Mise en forme des documents PDF : identique à l'interface (format marocain, chiffres
 * occidentaux dans les deux langues), sans Intl pour un rendu déterministe.
 */
const CURRENCY: Readonly<Record<DocLocale, string>> = { fr: 'MAD', ar: 'د.م.' };

/** 2270000 → « 22.700,00 » */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const units = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${units},${(absolute % 100).toString().padStart(2, '0')}`;
}

/** « ⟦22.700,00⟧ MAD » ou « ⟦22.700,00⟧ د.م. » (la devise reste hors du passage gauche-droite). */
export function money(cents: number, locale: DocLocale): string {
  return `${ltr(formatAmount(cents))} ${CURRENCY[locale]}`;
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
