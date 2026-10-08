import type { UiLocale } from '@/i18n/config';

/**
 * Montants en dirhams, au format marocain (convention CLDR « fr-MA ») :
 *   fr : 38.599,51 MAD
 *   ar : 38.599,51 د.م.   (chiffres occidentaux, usage courant au Maroc)
 *
 * Formatage volontairement manuel : Intl insère selon les versions des marques de direction
 * invisibles (U+200F) qui diffèrent entre serveur et navigateur et cassent l'hydratation React.
 */
const CURRENCY_LABEL: Readonly<Record<UiLocale, string>> = { fr: 'MAD', ar: 'د.م.' };
const NBSP = ' ';

/** Groupe les chiffres par milliers : 38599 → « 38.599 ». */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Montant en centimes → « 38.599,51 » (sans devise). */
export function formatAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Montant en centimes attendu');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const units = Math.floor(absolute / 100).toString();
  const decimals = (absolute % 100).toString().padStart(2, '0');
  return `${sign}${groupThousands(units)},${decimals}`;
}

/** Montant en centimes → « 38.599,51 MAD » ou « 38.599,51 د.م. ». */
export function formatMoney(cents: number, locale: UiLocale): string {
  return `${formatAmount(cents)}${NBSP}${CURRENCY_LABEL[locale]}`;
}

/** Libellé de la devise seul (suffixe des champs de saisie). */
export function currencyLabel(locale: UiLocale): string {
  return CURRENCY_LABEL[locale];
}

/** Partie entière avec points de milliers facultatifs : « 1.250.000 » ou « 1250000 ». */
const INTEGER_WITH_DOTS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Saisie d'un montant en dirhams → centimes. Règles :
 *   - la virgule est toujours le séparateur décimal (« 250,5 », « 1.250,50 ») ;
 *   - un point unique suivi de 1 ou 2 chiffres est décimal (« 250.50 », saisie au clavier anglais) ;
 *   - sinon les points séparent les milliers, par groupes de 3 (« 1.250 ») ;
 *   - les espaces sont ignorés ; 2 décimales au plus.
 * Retourne null si la saisie n'est pas un montant valide.
 */
export function parseAmountToCents(input: string): number | null {
  let value = input.replace(/[\s  ]/g, '');
  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);
  if (value === '') return null;

  let integerPart: string;
  let decimals = '';
  if (value.includes(',')) {
    const [before = '', after = '', ...rest] = value.split(',');
    if (rest.length > 0 || !/^\d{0,2}$/.test(after)) return null;
    integerPart = before;
    decimals = after;
  } else if (/^\d*\.\d{1,2}$/.test(value)) {
    [integerPart = '', decimals = ''] = value.split('.');
  } else {
    integerPart = value;
  }

  if (integerPart.includes('.')) {
    if (!INTEGER_WITH_DOTS.test(integerPart)) return null;
    integerPart = integerPart.replace(/\./g, '');
  }
  if (!/^\d*$/.test(integerPart) || (integerPart === '' && decimals === '')) return null;

  const cents = Number(integerPart || '0') * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Centimes → valeur éditable dans un champ (« 1250,50 »), sans séparateur de milliers. */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${(absolute % 100).toString().padStart(2, '0')}`;
}
