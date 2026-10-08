// Calculs monétaires de la plateforme.
//
// Règles :
// - Tous les montants sont des entiers en centimes (jamais de Float).
// - Les taux de TVA sont en points de base : 2000 = 20,00 %.
// - Les prix sont stockés HT. La TVA est calculée et arrondie au centime
//   PAR LIGNE ; les totaux d'un document sont la somme des lignes arrondies.
// - Arrondi « au plus proche, demi s'éloignant de zéro » : 0,5 centime → 1 centime,
//   −0,5 centime → −1 centime (symétrique pour les avoirs, dont les montants sont négatifs).

export const BPS_DENOMINATOR = 10_000;
export const MAX_TAX_RATE_BPS = BPS_DENOMINATOR;

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} doit être un entier sûr (reçu : ${value})`);
  }
}

function assertTaxRate(taxRateBps: number): void {
  assertSafeInteger(taxRateBps, 'taxRateBps');
  if (taxRateBps < 0 || taxRateBps > MAX_TAX_RATE_BPS) {
    throw new RangeError(`taxRateBps doit être compris entre 0 et ${MAX_TAX_RATE_BPS}`);
  }
}

/** Division entière arrondie au plus proche, le demi s'éloignant de zéro. */
export function divideAndRound(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator doit être strictement positif');

  const absolute = Math.abs(numerator);
  const quotient = Math.floor(absolute / denominator);
  const remainder = absolute - quotient * denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return numerator < 0 ? -rounded : rounded;
}

/** Montant de TVA (centimes) pour une base HT donnée. */
export function computeTax(amountHt: number, taxRateBps: number): number {
  assertTaxRate(taxRateBps);
  return divideAndRound(amountHt * taxRateBps, BPS_DENOMINATOR);
}

/** Convertit un montant HT en TTC. */
export function htToTtc(amountHt: number, taxRateBps: number): number {
  return amountHt + computeTax(amountHt, taxRateBps);
}

/**
 * Convertit un prix saisi TTC en prix HT à stocker.
 *
 * Choisit, parmi les HT voisins, celui qui redonne exactement le TTC saisi
 * (le client voit ainsi le prix que le traiteur a tapé). Certains TTC ne sont
 * atteignables par aucun HT entier (ex. 0,03 MAD à 20 %) : on retourne alors
 * l'arrondi le plus proche, l'écart est d'un centime au plus.
 */
export function ttcToHt(amountTtc: number, taxRateBps: number): number {
  assertTaxRate(taxRateBps);
  const estimate = divideAndRound(amountTtc * BPS_DENOMINATOR, BPS_DENOMINATOR + taxRateBps);
  for (const candidate of [estimate, estimate - 1, estimate + 1]) {
    if (htToTtc(candidate, taxRateBps) === amountTtc) return candidate;
  }
  return estimate;
}

export type PriceEntryMode = 'HT' | 'TTC';

/** Prix HT à stocker à partir du prix saisi par le traiteur. */
export function toStoredPriceHt(
  enteredPrice: number,
  mode: PriceEntryMode,
  taxRateBps: number,
): number {
  assertSafeInteger(enteredPrice, 'enteredPrice');
  return mode === 'HT' ? enteredPrice : ttcToHt(enteredPrice, taxRateBps);
}

export interface TaxSettings {
  isVatRegistered: boolean;
  defaultTaxRateBps: number;
}

/** Taux applicable à un article : 0 si non assujetti, sinon taux de l'article ou taux par défaut. */
export function resolveTaxRate(settings: TaxSettings, itemTaxRateBps: number | null): number {
  if (!settings.isVatRegistered) return 0;
  const rate = itemTaxRateBps ?? settings.defaultTaxRateBps;
  assertTaxRate(rate);
  return rate;
}

export interface LineInput {
  unitPriceHt: number;
  quantity: number;
  discountHt?: number;
  taxRateBps: number;
}

export interface LineAmounts {
  unitPriceHt: number;
  quantity: number;
  discountHt: number;
  taxRateBps: number;
  totalHt: number;
  taxAmount: number;
  totalTtc: number;
}

/** Calcule les montants d'une ligne (commande, devis, facture, avoir). */
export function computeLineAmounts({
  unitPriceHt,
  quantity,
  discountHt = 0,
  taxRateBps,
}: LineInput): LineAmounts {
  assertSafeInteger(unitPriceHt, 'unitPriceHt');
  assertSafeInteger(quantity, 'quantity');
  assertSafeInteger(discountHt, 'discountHt');
  assertTaxRate(taxRateBps);
  if (quantity <= 0) throw new RangeError('quantity doit être strictement positive');

  const grossHt = unitPriceHt * quantity;
  // La remise réduit la valeur absolue de la ligne, sans jamais en changer le signe.
  if (Math.sign(discountHt) * Math.sign(grossHt) < 0 || Math.abs(discountHt) > Math.abs(grossHt)) {
    throw new RangeError('discountHt doit être du même signe que la ligne et ne pas la dépasser');
  }

  const totalHt = grossHt - discountHt;
  const taxAmount = computeTax(totalHt, taxRateBps);
  return {
    unitPriceHt,
    quantity,
    discountHt,
    taxRateBps,
    totalHt,
    taxAmount,
    totalTtc: totalHt + taxAmount,
  };
}

export interface TaxBreakdownEntry {
  taxRateBps: number;
  baseHt: number;
  taxAmount: number;
}

export interface DocumentTotals {
  totalHt: number;
  totalTax: number;
  totalTtc: number;
  /** Ventilation par taux, affichée sur les devis et factures. */
  taxBreakdown: TaxBreakdownEntry[];
}

/** Totaux d'un document : somme des lignes déjà arrondies. */
export function computeDocumentTotals(
  lines: readonly Pick<LineAmounts, 'taxRateBps' | 'totalHt' | 'taxAmount'>[],
): DocumentTotals {
  const byRate = new Map<number, TaxBreakdownEntry>();
  let totalHt = 0;
  let totalTax = 0;

  for (const line of lines) {
    totalHt += line.totalHt;
    totalTax += line.taxAmount;
    const entry = byRate.get(line.taxRateBps) ?? {
      taxRateBps: line.taxRateBps,
      baseHt: 0,
      taxAmount: 0,
    };
    entry.baseHt += line.totalHt;
    entry.taxAmount += line.taxAmount;
    byRate.set(line.taxRateBps, entry);
  }

  return {
    totalHt,
    totalTax,
    totalTtc: totalHt + totalTax,
    taxBreakdown: [...byRate.values()].sort((a, b) => a.taxRateBps - b.taxRateBps),
  };
}

/** Inverse le signe des montants d'une ligne (création d'un avoir à partir d'une facture). */
export function negateLineAmounts(line: LineAmounts): LineAmounts {
  return {
    ...line,
    unitPriceHt: -line.unitPriceHt,
    discountHt: -line.discountHt,
    totalHt: -line.totalHt,
    taxAmount: -line.taxAmount,
    totalTtc: -line.totalTtc,
  };
}

/** Formate un montant en centimes pour l'affichage (ex. « 1 250,00 MAD »). */
export function formatMoney(amountCents: number, locale = 'fr-MA', currency = 'MAD'): string {
  assertSafeInteger(amountCents, 'amountCents');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

/** Formate un taux en points de base (ex. 2000 → « 20 % »). */
export function formatTaxRate(taxRateBps: number): string {
  assertTaxRate(taxRateBps);
  const percent = taxRateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)} %`;
}
