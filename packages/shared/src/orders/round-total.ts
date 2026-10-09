import { computeLineAmounts, computeTax, type PriceMode } from '../money/money';

/**
 * « Arrondir le total » : le traiteur saisit le total TTC voulu ; la remise nécessaire est
 * répartie sur les lignes, au prorata de leur montant brut, en remises de ligne (exprimées dans
 * le mode de prix du document). Le reliquat d'arrondi va à la plus grosse ligne, pour tomber
 * exactement sur le montant saisi.
 *
 * Les remises calculées REMPLACENT les remises existantes : le total visé est atteint à partir
 * des montants bruts (prix unitaire × quantité).
 *
 * Mode TTC : le résultat est toujours exact.
 * Mode HT : la remise est saisie HT et la TVA est arrondie sur chaque ligne ; certains totaux
 * TTC sont inatteignables au centime près (ex. une seule ligne à 20 % : 3 centimes TTC n'existe
 * pas). Le total le plus proche par défaut est alors retenu et `exact` vaut false.
 */

export interface RoundableLine {
  /** Prix unitaire dans le mode du document (centimes). */
  unitPrice: number;
  quantity: number;
  taxRateBps: number;
}

export interface RoundTotalResult {
  /** Remise de chaque ligne, dans le mode du document (centimes), même ordre que l'entrée. */
  discounts: number[];
  /** Total TTC obtenu avec ces remises. */
  totalTtc: number;
  exact: boolean;
}

/** Total TTC maximal (sans aucune remise) : borne haute du montant saisissable. */
export function grossTotalTtc(priceMode: PriceMode, lines: readonly RoundableLine[]): number {
  return lines.reduce((sum, line) => sum + lineTtc(priceMode, line, 0), 0);
}

function lineTtc(priceMode: PriceMode, line: RoundableLine, discount: number): number {
  const { quantity, taxRateBps, unitPrice } = line;
  const amounts =
    priceMode === 'TTC'
      ? computeLineAmounts({
          priceMode,
          unitPriceTtc: unitPrice,
          discountTtc: discount,
          quantity,
          taxRateBps,
        })
      : computeLineAmounts({
          priceMode,
          unitPriceHt: unitPrice,
          discountHt: discount,
          quantity,
          taxRateBps,
        });
  return amounts.totalTtc;
}

/** Répartit `total` au prorata de `weights` (entiers ≥ 0), reliquat sur le plus gros poids. */
function prorata(total: number, weights: readonly number[], caps: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum === 0) return weights.map(() => 0);
  // BigInt : total × poids peut dépasser 2^53 centimes²
  const shares = weights.map((weight) => Number((BigInt(total) * BigInt(weight)) / BigInt(sum)));
  let remainder = total - shares.reduce((acc, share) => acc + share, 0);
  const byWeight = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { index } of byWeight) {
    if (remainder === 0) break;
    const room = (caps[index] ?? 0) - (shares[index] ?? 0);
    const added = Math.min(room, remainder);
    shares[index] = (shares[index] ?? 0) + added;
    remainder -= added;
  }
  return shares;
}

export function discountsForTargetTotal(
  priceMode: PriceMode,
  lines: readonly RoundableLine[],
  targetTtc: number,
): RoundTotalResult {
  if (!Number.isSafeInteger(targetTtc) || targetTtc < 0) {
    throw new RangeError('Le total visé doit être un montant positif en centimes');
  }
  const gross = lines.map((line) => line.unitPrice * line.quantity);
  if (gross.some((value) => value < 0)) {
    throw new RangeError('Les lignes négatives ne peuvent pas être arrondies');
  }
  const maxTtc = grossTotalTtc(priceMode, lines);
  if (targetTtc > maxTtc) {
    throw new RangeError('Le total visé dépasse le total sans remise');
  }

  if (priceMode === 'TTC') {
    // Remise totale TTC répartie au prorata des montants bruts TTC : exact par construction.
    const discounts = prorata(maxTtc - targetTtc, gross, gross);
    return { discounts, totalTtc: targetTtc, exact: true };
  }

  // Mode HT : on répartit le TTC visé, puis on cherche pour chaque ligne la base HT qui en
  // approche par défaut ; le reliquat est ensuite comblé centime par centime.
  const ttcOf = (index: number, baseHt: number) =>
    baseHt + computeTax(baseHt, lines[index]?.taxRateBps ?? 0);
  const maxPerLine = gross.map((value, index) => ttcOf(index, value));
  const targets = prorata(targetTtc, maxPerLine, maxPerLine);

  const bases = targets.map((target, index) => {
    const cap = gross[index] ?? 0;
    const rate = lines[index]?.taxRateBps ?? 0;
    let base = Math.min(cap, Math.floor((target * 10_000) / (10_000 + rate)));
    while (base < cap && ttcOf(index, base + 1) <= target) base += 1;
    while (base > 0 && ttcOf(index, base) > target) base -= 1;
    return base;
  });

  const total = () => bases.reduce((sum, base, index) => sum + ttcOf(index, base), 0);
  // Lignes de la plus grosse à la plus petite : le reliquat va d'abord à la plus grosse.
  const order = maxPerLine
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(({ index }) => index);

  for (let guard = 0; guard < lines.length * 4 + 10; guard += 1) {
    const missing = targetTtc - total();
    if (missing === 0) break;
    const step = (index: number, direction: 1 | -1) =>
      ttcOf(index, (bases[index] ?? 0) + direction) - ttcOf(index, bases[index] ?? 0);
    const canUp = (index: number) => (bases[index] ?? 0) < (gross[index] ?? 0);
    const canDown = (index: number) => (bases[index] ?? 0) > 0;

    // 1. Un centime HT de plus sur une ligne qui ne dépasse pas le total visé
    const up = order.find((index) => canUp(index) && step(index, 1) <= missing);
    if (up !== undefined) {
      bases[up] = (bases[up] ?? 0) + 1;
      continue;
    }
    // 2. Échange : +1 HT sur une ligne (+2 TTC) et −1 HT sur une autre (−1 TTC)
    const pair = order
      .flatMap((a) => order.map((b) => [a, b] as const))
      .find(
        ([a, b]) =>
          a !== b &&
          canUp(a) &&
          canDown(b) &&
          step(a, 1) + step(b, -1) > 0 &&
          step(a, 1) + step(b, -1) <= missing,
      );
    if (!pair) break;
    bases[pair[0]] = (bases[pair[0]] ?? 0) + 1;
    bases[pair[1]] = (bases[pair[1]] ?? 0) - 1;
  }

  const discounts = bases.map((base, index) => (gross[index] ?? 0) - base);
  const achieved = lines.reduce(
    (sum, line, index) => sum + lineTtc(priceMode, line, discounts[index] ?? 0),
    0,
  );
  return { discounts, totalTtc: achieved, exact: achieved === targetTtc };
}
