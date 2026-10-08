// Calculs monétaires de la plateforme.
//
// Règles :
// - Tous les montants sont des entiers en centimes (jamais de Float).
// - Les taux de TVA sont en points de base : 2000 = 20,00 %.
// - Chaque ligne est calculée dans un mode de prix, figé sur le document :
//     HT  : totalHt  = PU HT × quantité − remise HT ; TVA = arrondi(totalHt × taux) ;
//           totalTtc = totalHt + TVA
//     TTC : totalTtc = PU TTC × quantité − remise TTC ; totalHt = arrondi(totalTtc / (1 + taux)) ;
//           TVA = totalTtc − totalHt
//   Dans les deux cas, HT + TVA = TTC exactement sur chaque ligne, et le montant saisi
//   (HT ou TTC) est restitué au centime près.
// - Les totaux d'un document sont la somme des lignes, jamais recalculés depuis un total.
// - Arrondi « au plus proche, demi s'éloignant de zéro » : symétrique pour les avoirs
//   (montants négatifs). C'est aussi le comportement de round(numeric) dans PostgreSQL,
//   utilisé par les contraintes CHECK de la base.

export const BPS_DENOMINATOR = 10_000;
export const MAX_TAX_RATE_BPS = BPS_DENOMINATOR;

export const PRICE_MODES = ['HT', 'TTC'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];
/** Alias historique : mode de saisie des prix du traiteur. */
export type PriceEntryMode = PriceMode;

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
 * Part HT d'un montant TTC : arrondi(TTC / (1 + taux)).
 * C'est la règle des lignes en mode TTC (la TVA est la différence).
 */
export function extractHt(amountTtc: number, taxRateBps: number): number {
  assertTaxRate(taxRateBps);
  return divideAndRound(amountTtc * BPS_DENOMINATOR, BPS_DENOMINATOR + taxRateBps);
}

/**
 * Convertit un prix TTC en un prix HT qui redonne si possible exactement ce TTC par htToTtc.
 * Sert uniquement à la valeur indicative HT d'un prix saisi TTC (catalogue, affichage) :
 * les calculs de lignes en mode TTC partent du TTC et n'en dépendent pas.
 */
export function ttcToHt(amountTtc: number, taxRateBps: number): number {
  const estimate = extractHt(amountTtc, taxRateBps);
  for (const candidate of [estimate, estimate - 1, estimate + 1]) {
    if (htToTtc(candidate, taxRateBps) === amountTtc) return candidate;
  }
  return estimate;
}

export interface CatalogPrices {
  /** Prix HT (centimes). Fait foi en mode HT, dérivé en mode TTC. */
  priceHt: number;
  /** Prix TTC (centimes). Fait foi en mode TTC, dérivé en mode HT. */
  priceTtc: number;
}

/**
 * Prix à enregistrer au catalogue à partir du prix saisi par le traiteur.
 * Le prix saisi est conservé tel quel ; l'autre est dérivé avec le taux applicable.
 */
export function computeCatalogPrices(
  enteredPrice: number,
  mode: PriceMode,
  taxRateBps: number,
): CatalogPrices {
  assertSafeInteger(enteredPrice, 'enteredPrice');
  if (enteredPrice < 0) throw new RangeError('Un prix de catalogue ne peut pas être négatif');
  return mode === 'HT'
    ? { priceHt: enteredPrice, priceTtc: htToTtc(enteredPrice, taxRateBps) }
    : { priceHt: ttcToHt(enteredPrice, taxRateBps), priceTtc: enteredPrice };
}

/** Prix unitaire qui fait foi pour une ligne, selon le mode du document. */
export function unitPriceFor(prices: CatalogPrices, mode: PriceMode): number {
  return mode === 'HT' ? prices.priceHt : prices.priceTtc;
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

/** Saisie d'une ligne : le prix unitaire et la remise sont exprimés dans le mode de la ligne. */
export type LineInput =
  | {
      priceMode: 'HT';
      unitPriceHt: number;
      quantity: number;
      discountHt?: number;
      taxRateBps: number;
    }
  | {
      priceMode: 'TTC';
      unitPriceTtc: number;
      quantity: number;
      discountTtc?: number;
      taxRateBps: number;
    };

/**
 * Montants d'une ligne. Les prix unitaires et remises du mode de la ligne font foi ;
 * ceux de l'autre mode sont indicatifs (affichage), sans effet sur les totaux.
 */
export interface LineAmounts {
  priceMode: PriceMode;
  quantity: number;
  taxRateBps: number;
  unitPriceHt: number;
  unitPriceTtc: number;
  discountHt: number;
  discountTtc: number;
  totalHt: number;
  taxAmount: number;
  totalTtc: number;
}

function assertDiscount(discount: number, gross: number, name: string): void {
  assertSafeInteger(discount, name);
  // La remise réduit la valeur absolue de la ligne, sans jamais en changer le signe.
  if (Math.sign(discount) * Math.sign(gross) < 0 || Math.abs(discount) > Math.abs(gross)) {
    throw new RangeError(`${name} doit être du même signe que la ligne et ne pas la dépasser`);
  }
}

/** Calcule les montants d'une ligne (commande, devis, facture, avoir). */
export function computeLineAmounts(input: LineInput): LineAmounts {
  const { quantity, taxRateBps } = input;
  assertSafeInteger(quantity, 'quantity');
  assertTaxRate(taxRateBps);
  if (quantity <= 0) throw new RangeError('quantity doit être strictement positive');

  if (input.priceMode === 'HT') {
    const { unitPriceHt, discountHt = 0 } = input;
    assertSafeInteger(unitPriceHt, 'unitPriceHt');
    const grossHt = unitPriceHt * quantity;
    assertDiscount(discountHt, grossHt, 'discountHt');

    const totalHt = grossHt - discountHt;
    const taxAmount = computeTax(totalHt, taxRateBps);
    return {
      priceMode: 'HT',
      quantity,
      taxRateBps,
      unitPriceHt,
      unitPriceTtc: htToTtc(unitPriceHt, taxRateBps),
      discountHt,
      discountTtc: htToTtc(discountHt, taxRateBps),
      totalHt,
      taxAmount,
      totalTtc: totalHt + taxAmount,
    };
  }

  const { unitPriceTtc, discountTtc = 0 } = input;
  assertSafeInteger(unitPriceTtc, 'unitPriceTtc');
  const grossTtc = unitPriceTtc * quantity;
  assertDiscount(discountTtc, grossTtc, 'discountTtc');

  const totalTtc = grossTtc - discountTtc;
  const totalHt = extractHt(totalTtc, taxRateBps);
  return {
    priceMode: 'TTC',
    quantity,
    taxRateBps,
    unitPriceHt: ttcToHt(unitPriceTtc, taxRateBps),
    unitPriceTtc,
    discountHt: ttcToHt(discountTtc, taxRateBps),
    discountTtc,
    totalHt,
    taxAmount: totalTtc - totalHt,
    totalTtc,
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
  /**
   * Récapitulatif de TVA par taux (base HT, taux, montant), trié par taux croissant.
   * Obligatoire sur une facture dès que plusieurs taux coexistent.
   */
  taxBreakdown: TaxBreakdownEntry[];
}

/** Totaux d'un document : somme des lignes déjà arrondies, jamais recalculés depuis un total. */
export function computeDocumentTotals(
  lines: readonly Pick<LineAmounts, 'taxRateBps' | 'totalHt' | 'taxAmount' | 'totalTtc'>[],
): DocumentTotals {
  const byRate = new Map<number, TaxBreakdownEntry>();
  let totalHt = 0;
  let totalTax = 0;
  let totalTtc = 0;

  for (const line of lines) {
    totalHt += line.totalHt;
    totalTax += line.taxAmount;
    totalTtc += line.totalTtc;
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
    totalTtc,
    taxBreakdown: [...byRate.values()].sort((a, b) => a.taxRateBps - b.taxRateBps),
  };
}

/** Inverse le signe des montants d'une ligne (avoir à partir d'une facture), mode conservé. */
export function negateLineAmounts(line: LineAmounts): LineAmounts {
  return {
    ...line,
    unitPriceHt: -line.unitPriceHt,
    unitPriceTtc: -line.unitPriceTtc,
    discountHt: -line.discountHt,
    discountTtc: -line.discountTtc,
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
