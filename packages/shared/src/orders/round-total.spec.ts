import { describe, expect, it } from 'vitest';

import { computeDocumentTotals, computeLineAmounts, type PriceMode } from '../money/money';
import { discountsForTargetTotal, grossTotalTtc, type RoundableLine } from './round-total';

/** Totaux du document après application des remises, exactement comme l'API les calcule. */
function totalWith(priceMode: PriceMode, lines: RoundableLine[], discounts: number[]) {
  const amounts = lines.map((line, index) =>
    priceMode === 'TTC'
      ? computeLineAmounts({
          priceMode,
          unitPriceTtc: line.unitPrice,
          discountTtc: discounts[index] ?? 0,
          quantity: line.quantity,
          taxRateBps: line.taxRateBps,
        })
      : computeLineAmounts({
          priceMode,
          unitPriceHt: line.unitPrice,
          discountHt: discounts[index] ?? 0,
          quantity: line.quantity,
          taxRateBps: line.taxRateBps,
        }),
  );
  return computeDocumentTotals(amounts).totalTtc;
}

// Formule à 250 MAD × 120 (20 %), jus 15 MAD × 120 (10 %), 4 serveurs à 400 MAD (20 %),
// location de vaisselle 7 MAD × 120 (14 %)
const TTC_LINES: RoundableLine[] = [
  { unitPrice: 25_000, quantity: 120, taxRateBps: 2000 },
  { unitPrice: 1_500, quantity: 120, taxRateBps: 1000 },
  { unitPrice: 40_000, quantity: 4, taxRateBps: 2000 },
  { unitPrice: 700, quantity: 120, taxRateBps: 1400 },
];
const HT_LINES: RoundableLine[] = [
  { unitPrice: 20_833, quantity: 120, taxRateBps: 2000 },
  { unitPrice: 1_364, quantity: 120, taxRateBps: 1000 },
  { unitPrice: 33_333, quantity: 4, taxRateBps: 2000 },
  { unitPrice: 614, quantity: 120, taxRateBps: 1400 },
];

describe('discountsForTargetTotal', () => {
  it('mode TTC : tombe exactement sur le total saisi, avec plusieurs taux de TVA', () => {
    const gross = grossTotalTtc('TTC', TTC_LINES); // 34 240,00
    expect(gross).toBe(3_424_000);
    for (const target of [3_400_000, 3_333_333, 3_000_001, 1, 0, gross]) {
      const result = discountsForTargetTotal('TTC', TTC_LINES, target);
      expect(result.exact).toBe(true);
      expect(totalWith('TTC', TTC_LINES, result.discounts)).toBe(target);
    }
  });

  it('mode TTC : répartit au prorata, le reliquat sur la plus grosse ligne', () => {
    const { discounts } = discountsForTargetTotal('TTC', TTC_LINES, 3_400_000); // −240,00
    // Parts arrondies par défaut : 210,28 ; 12,61 ; 11,21 ; 5,88 = 239,98
    // Reliquat de 2 centimes sur la plus grosse ligne : 210,30
    expect(discounts).toEqual([21_030, 1_261, 1_121, 588]);
    expect(discounts.reduce((sum, value) => sum + value, 0)).toBe(24_000);
  });

  it('mode HT : total TTC exact avec plusieurs taux de TVA', () => {
    const gross = grossTotalTtc('HT', HT_LINES);
    for (const target of [3_400_000, 3_333_333, 3_000_001, 2_999_999, 1_000_000]) {
      expect(target).toBeLessThanOrEqual(gross);
      const result = discountsForTargetTotal('HT', HT_LINES, target);
      expect(result.exact, `cible ${target}`).toBe(true);
      expect(totalWith('HT', HT_LINES, result.discounts)).toBe(target);
    }
  });

  it('les remises restent comprises entre 0 et le montant brut de chaque ligne', () => {
    for (const mode of ['HT', 'TTC'] as const) {
      const lines = mode === 'HT' ? HT_LINES : TTC_LINES;
      const { discounts } = discountsForTargetTotal(mode, lines, 1_234_567);
      discounts.forEach((discount, index) => {
        const line = lines[index];
        expect(discount).toBeGreaterThanOrEqual(0);
        expect(discount).toBeLessThanOrEqual((line?.unitPrice ?? 0) * (line?.quantity ?? 0));
      });
    }
  });

  it('mode HT : un total inatteignable donne le plus proche par défaut, signalé', () => {
    // Une seule ligne à 20 % : 1,00 HT → 1,20 TTC ; 3 centimes TTC n'existe pas (2 → 2, 3 → 4)
    const lines = [{ unitPrice: 100, quantity: 1, taxRateBps: 2000 }];
    const result = discountsForTargetTotal('HT', lines, 3);
    expect(result.exact).toBe(false);
    expect(result.totalTtc).toBe(2);
    expect(totalWith('HT', lines, result.discounts)).toBe(2);
  });

  it('refuse un total supérieur au total sans remise ou négatif', () => {
    expect(() => discountsForTargetTotal('TTC', TTC_LINES, 3_424_001)).toThrow(RangeError);
    expect(() => discountsForTargetTotal('TTC', TTC_LINES, -1)).toThrow(RangeError);
  });

  it('remplace les remises existantes (repart des montants bruts)', () => {
    const { discounts } = discountsForTargetTotal(
      'TTC',
      TTC_LINES,
      grossTotalTtc('TTC', TTC_LINES),
    );
    expect(discounts).toEqual([0, 0, 0, 0]);
  });
});
