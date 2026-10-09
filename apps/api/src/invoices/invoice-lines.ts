import {
  computeDocumentTotals,
  computeLineAmounts,
  divideAndRound,
  type DocumentTotals,
  type LineAmounts,
  negateLineAmounts,
  type PriceMode,
} from '@traiteur/shared';

/**
 * Lignes des factures et des avoirs, calculées à partir des montants déjà arrondis (jamais
 * recalculés depuis un total). La base revérifie chaque ligne (CHECK) et les totaux (trigger).
 */
export type InvoiceItemType = 'DISH' | 'PACKAGE' | 'EXTRA_SERVICE' | 'CUSTOM';

export interface InvoiceLineDraft extends LineAmounts {
  itemType: InvoiceItemType;
  label: string;
}

/** Ligne enregistrée (commande, facture) dont on reprend les montants tels quels. */
export interface StoredLine {
  itemType: InvoiceItemType;
  label: string;
  priceMode: PriceMode;
  quantity: number;
  unitPriceHt: number;
  unitPriceTtc: number;
  discountHt: number;
  discountTtc: number;
  taxRateBps: number;
  totalHt: number;
  taxAmount: number;
  totalTtc: number;
}

/**
 * Répartit un montant entier selon des poids (méthode des plus forts restes) : la somme des
 * parts est exactement le montant, chaque part est proportionnelle à son poids à 1 près.
 */
export function prorate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amount * weight) / total);
  const shares = exact.map(Math.floor);
  let rest = amount - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (rest <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    rest -= 1;
  }
  return shares;
}

/** TTC par taux de TVA (taux croissants). */
function ttcByRate(lines: readonly Pick<LineAmounts, 'taxRateBps' | 'totalTtc'>[]) {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    byRate.set(line.taxRateBps, (byRate.get(line.taxRateBps) ?? 0) + line.totalTtc);
  }
  return [...byRate.entries()].sort(([a], [b]) => a - b);
}

/**
 * Ligne d'un montant TTC à un taux donné, dans le mode de prix du document. En mode HT, la
 * base HT est déduite du TTC (le TTC obtenu peut alors différer d'un centime).
 */
function amountLine(
  priceMode: PriceMode,
  amountTtc: number,
  taxRateBps: number,
  label: string,
): InvoiceLineDraft {
  const amounts =
    priceMode === 'TTC'
      ? computeLineAmounts({ priceMode, unitPriceTtc: amountTtc, quantity: 1, taxRateBps })
      : computeLineAmounts({
          priceMode,
          unitPriceHt: divideAndRound(amountTtc * 10_000, 10_000 + taxRateBps),
          quantity: 1,
          taxRateBps,
        });
  return { ...amounts, itemType: 'CUSTOM', label };
}

/** Montant réparti par taux, au prorata du TTC de chaque taux des lignes de référence. */
function prorataLines(
  priceMode: PriceMode,
  amountTtc: number,
  reference: readonly Pick<LineAmounts, 'taxRateBps' | 'totalTtc'>[],
  label: (taxRateBps: number, several: boolean) => string,
): InvoiceLineDraft[] {
  const rates = ttcByRate(reference).filter(([, ttc]) => ttc > 0);
  const shares = prorate(
    amountTtc,
    rates.map(([, ttc]) => ttc),
  );
  return rates.flatMap(([rate], index) => {
    const share = shares[index] ?? 0;
    return share > 0 ? [amountLine(priceMode, share, rate, label(rate, rates.length > 1))] : [];
  });
}

/** Copie exacte de lignes enregistrées (facture totale, lignes de la commande d'un solde). */
export function copyLines(lines: readonly StoredLine[]): InvoiceLineDraft[] {
  return lines.map((line) => ({
    itemType: line.itemType,
    label: line.label,
    priceMode: line.priceMode,
    quantity: line.quantity,
    unitPriceHt: line.unitPriceHt,
    unitPriceTtc: line.unitPriceTtc,
    discountHt: line.discountHt,
    discountTtc: line.discountTtc,
    taxRateBps: line.taxRateBps,
    totalHt: line.totalHt,
    taxAmount: line.taxAmount,
    totalTtc: line.totalTtc,
  }));
}

/** Facture d'acompte : une ligne par taux de TVA de la commande, au prorata. */
export function depositLines(
  priceMode: PriceMode,
  amountTtc: number,
  orderLines: readonly Pick<LineAmounts, 'taxRateBps' | 'totalTtc'>[],
  label: (taxRateBps: number, several: boolean) => string,
): InvoiceLineDraft[] {
  return prorataLines(priceMode, amountTtc, orderLines, label);
}

/** Acomptes déjà facturés, déduits d'une facture de solde : leurs lignes en négatif. */
export function deductionLines(
  deposits: readonly { number: string; lines: readonly StoredLine[] }[],
  label: (number: string, taxRateBps: number, several: boolean) => string,
): InvoiceLineDraft[] {
  return deposits.flatMap((deposit) =>
    copyLines(deposit.lines).map((line) => ({
      ...negateLineAmounts(line),
      itemType: 'CUSTOM' as const,
      label: label(deposit.number, line.taxRateBps, deposit.lines.length > 1),
    })),
  );
}

/** Avoir total : toutes les lignes de la facture, en négatif. */
export function fullCreditLines(lines: readonly StoredLine[]): InvoiceLineDraft[] {
  return copyLines(lines).map((line) => ({
    ...negateLineAmounts(line),
    itemType: line.itemType,
    label: line.label,
  }));
}

/** Avoir partiel (remboursement) : montant réparti par taux comme la facture, en négatif. */
export function partialCreditLines(
  priceMode: PriceMode,
  amountTtc: number,
  invoiceLines: readonly StoredLine[],
  label: (taxRateBps: number, several: boolean) => string,
): InvoiceLineDraft[] {
  return prorataLines(priceMode, amountTtc, invoiceLines, label).map((line) => ({
    ...negateLineAmounts(line),
    itemType: line.itemType,
    label: line.label,
  }));
}

/** Frais d'annulation : une ligne TTC au taux choisi par le traiteur. */
export function cancellationFeeLines(
  amountTtc: number,
  taxRateBps: number,
  label: string,
): InvoiceLineDraft[] {
  return [amountLine('TTC', amountTtc, taxRateBps, label)];
}

export function invoiceTotals(lines: readonly InvoiceLineDraft[]): DocumentTotals {
  return computeDocumentTotals(lines);
}
