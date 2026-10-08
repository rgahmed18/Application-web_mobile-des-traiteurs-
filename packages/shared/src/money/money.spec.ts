import { describe, expect, it } from 'vitest';

import {
  computeCatalogPrices,
  computeDocumentTotals,
  computeLineAmounts,
  computeTax,
  divideAndRound,
  extractHt,
  formatTaxRate,
  htToTtc,
  type LineAmounts,
  negateLineAmounts,
  resolveTaxRate,
  ttcToHt,
} from './money';

const MOROCCAN_RATES = [700, 1000, 1400, 2000] as const;

/** Invariant commun à toute ligne : HT + TVA = TTC exactement. */
function expectBalanced(line: LineAmounts): void {
  expect(line.totalHt + line.taxAmount).toBe(line.totalTtc);
}

describe('divideAndRound', () => {
  it('arrondit au plus proche', () => {
    expect(divideAndRound(14, 10)).toBe(1);
    expect(divideAndRound(16, 10)).toBe(2);
  });

  it('arrondit le demi en s’éloignant de zéro, de façon symétrique', () => {
    expect(divideAndRound(15, 10)).toBe(2);
    expect(divideAndRound(-15, 10)).toBe(-2);
    expect(divideAndRound(-14, 10)).toBe(-1);
  });

  it('refuse les nombres non entiers et un dénominateur nul', () => {
    expect(() => divideAndRound(1.5, 10)).toThrow(RangeError);
    expect(() => divideAndRound(10, 0)).toThrow(RangeError);
  });
});

describe('conversions HT / TTC', () => {
  it('calcule la TVA à 20 % et l’arrondit au centime', () => {
    expect(computeTax(10_000, 2000)).toBe(2_000);
    expect(computeTax(33, 2000)).toBe(7); // 6,6 → 7
    expect(computeTax(32, 2000)).toBe(6); // 6,4 → 6
    expect(htToTtc(10_000, 2000)).toBe(12_000);
  });

  it('extrait la part HT d’un TTC', () => {
    expect(extractHt(12_000, 2000)).toBe(10_000);
    expect(extractHt(3_000_000, 2000)).toBe(2_500_000);
    expect(extractHt(1_200, 700)).toBe(1_121); // 11,2149… → 11,21
  });

  it('ttcToHt choisit le HT qui redonne le TTC quand il existe', () => {
    expect(ttcToHt(35_000, 2000)).toBe(29_167);
    expect(htToTtc(ttcToHt(35_000, 2000), 2000)).toBe(35_000);
  });

  it('refuse un taux hors bornes', () => {
    expect(() => computeTax(100, -1)).toThrow(RangeError);
    expect(() => extractHt(100, 10_001)).toThrow(RangeError);
  });
});

describe('computeCatalogPrices', () => {
  it('en mode TTC, conserve le TTC saisi et dérive le HT', () => {
    expect(computeCatalogPrices(25_000, 'TTC', 2000)).toEqual({
      priceHt: 20_833,
      priceTtc: 25_000,
    });
  });

  it('en mode TTC, conserve le TTC saisi même s’il n’est pas atteignable depuis un HT', () => {
    // 12,00 MAD à 7 % : aucun HT entier ne redonne 12,00 ; le TTC saisi fait foi.
    expect(computeCatalogPrices(1_200, 'TTC', 700).priceTtc).toBe(1_200);
  });

  it('en mode HT, conserve le HT saisi et dérive le TTC', () => {
    expect(computeCatalogPrices(10_000, 'HT', 2000)).toEqual({ priceHt: 10_000, priceTtc: 12_000 });
  });

  it('refuse un prix négatif', () => {
    expect(() => computeCatalogPrices(-1, 'TTC', 2000)).toThrow(RangeError);
  });
});

describe('resolveTaxRate', () => {
  const settings = { isVatRegistered: true, defaultTaxRateBps: 2000 };

  it('applique un taux nul si le traiteur n’est pas assujetti', () => {
    expect(resolveTaxRate({ ...settings, isVatRegistered: false }, 1000)).toBe(0);
  });

  it('privilégie le taux de l’article, sinon le taux par défaut', () => {
    expect(resolveTaxRate(settings, 1000)).toBe(1000);
    expect(resolveTaxRate(settings, null)).toBe(2000);
  });
});

describe('computeLineAmounts — mode TTC', () => {
  it('250 MAD TTC × 120 invités = exactement 30 000,00 MAD', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 25_000,
      quantity: 120,
      taxRateBps: 2000,
    });
    expect(line.totalTtc).toBe(3_000_000);
    expect(line.totalHt).toBe(2_500_000);
    expect(line.taxAmount).toBe(500_000);
    expectBalanced(line);
  });

  it.each(MOROCCAN_RATES)(
    'à %i pb, aucun écart d’un centime : TTC = PU TTC × quantité pour tous les prix ronds',
    (rate) => {
      for (let dirhams = 1; dirhams <= 2_000; dirhams += 1) {
        for (const quantity of [1, 7, 120]) {
          const line = computeLineAmounts({
            priceMode: 'TTC',
            unitPriceTtc: dirhams * 100,
            quantity,
            taxRateBps: rate,
          });
          if (line.totalTtc !== dirhams * 100 * quantity) {
            throw new Error(`Écart pour ${dirhams} MAD × ${quantity} au taux ${rate}`);
          }
          if (line.totalHt + line.taxAmount !== line.totalTtc) {
            throw new Error(`Ligne déséquilibrée pour ${dirhams} MAD × ${quantity}`);
          }
        }
      }
    },
  );

  it('12,00 MAD TTC à 7 % reste 12,00 (ce que le stockage HT seul ne permettait pas)', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 1_200,
      quantity: 1,
      taxRateBps: 700,
    });
    expect(line).toMatchObject({ totalTtc: 1_200, totalHt: 1_121, taxAmount: 79 });
  });

  it('applique la remise TTC avant d’extraire le HT', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 800_000,
      quantity: 1,
      discountTtc: 100_000,
      taxRateBps: 2000,
    });
    expect(line.totalTtc).toBe(700_000);
    expect(line.totalHt).toBe(583_333);
    expect(line.taxAmount).toBe(116_667);
    expectBalanced(line);
  });

  it('fournit le HT unitaire et la remise HT à titre indicatif', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 25_000,
      quantity: 2,
      discountTtc: 1_200,
      taxRateBps: 2000,
    });
    expect(line.unitPriceHt).toBe(20_833);
    expect(line.discountHt).toBe(1_000);
  });

  it('refuse une remise supérieure à la ligne ou de signe opposé', () => {
    const base = { priceMode: 'TTC', unitPriceTtc: 1_000, quantity: 1, taxRateBps: 2000 } as const;
    expect(() => computeLineAmounts({ ...base, discountTtc: 1_001 })).toThrow(RangeError);
    expect(() => computeLineAmounts({ ...base, discountTtc: -1 })).toThrow(RangeError);
  });
});

describe('computeLineAmounts — mode HT', () => {
  it('calcule HT, TVA et TTC d’une ligne', () => {
    expect(
      computeLineAmounts({ priceMode: 'HT', unitPriceHt: 15_000, quantity: 3, taxRateBps: 2000 }),
    ).toEqual({
      priceMode: 'HT',
      quantity: 3,
      taxRateBps: 2000,
      unitPriceHt: 15_000,
      unitPriceTtc: 18_000,
      discountHt: 0,
      discountTtc: 0,
      totalHt: 45_000,
      taxAmount: 9_000,
      totalTtc: 54_000,
    });
  });

  it.each(MOROCCAN_RATES)('à %i pb, HT = PU HT × quantité pour tous les prix ronds', (rate) => {
    for (let dirhams = 1; dirhams <= 2_000; dirhams += 1) {
      const line = computeLineAmounts({
        priceMode: 'HT',
        unitPriceHt: dirhams * 100,
        quantity: 120,
        taxRateBps: rate,
      });
      if (line.totalHt !== dirhams * 100 * 120 || line.totalHt + line.taxAmount !== line.totalTtc) {
        throw new Error(`Écart pour ${dirhams} MAD HT au taux ${rate}`);
      }
    }
  });

  it('applique la remise HT avant la TVA', () => {
    const line = computeLineAmounts({
      priceMode: 'HT',
      unitPriceHt: 10_000,
      quantity: 2,
      discountHt: 1_000,
      taxRateBps: 2000,
    });
    expect(line).toMatchObject({ totalHt: 19_000, taxAmount: 3_800, totalTtc: 22_800 });
  });

  it('arrondit la TVA sur le total de la ligne, pas sur le prix unitaire', () => {
    // 3 × 0,33 = 0,99 HT → TVA 0,198 → 0,20 (et non 3 × 0,07 = 0,21)
    const line = computeLineAmounts({
      priceMode: 'HT',
      unitPriceHt: 33,
      quantity: 3,
      taxRateBps: 2000,
    });
    expect(line).toMatchObject({ taxAmount: 20, totalTtc: 119 });
  });

  it('refuse une quantité nulle', () => {
    expect(() =>
      computeLineAmounts({ priceMode: 'HT', unitPriceHt: 100, quantity: 0, taxRateBps: 0 }),
    ).toThrow(RangeError);
  });
});

describe('avoirs (montants négatifs)', () => {
  it('une ligne négative en mode TTC reste équilibrée et symétrique', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: -25_000,
      quantity: 120,
      taxRateBps: 2000,
    });
    expect(line).toMatchObject({ totalTtc: -3_000_000, totalHt: -2_500_000, taxAmount: -500_000 });
  });

  it('negateLineAmounts conserve le mode et inverse tous les montants', () => {
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 1_200,
      quantity: 3,
      discountTtc: 100,
      taxRateBps: 700,
    });
    const negated = negateLineAmounts(line);
    expect(negated.priceMode).toBe('TTC');
    expect(negated.totalTtc).toBe(-line.totalTtc);
    expect(negated.discountTtc).toBe(-line.discountTtc);
    expectBalanced(negated);
  });

  it('un avoir total annule exactement la facture, dans les deux modes', () => {
    const invoiceLines = [
      computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 25_000,
        quantity: 120,
        taxRateBps: 2000,
      }),
      computeLineAmounts({ priceMode: 'TTC', unitPriceTtc: 1_200, quantity: 7, taxRateBps: 700 }),
      computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 800_000,
        quantity: 1,
        discountTtc: 100_000,
        taxRateBps: 1000,
      }),
    ];
    const invoice = computeDocumentTotals(invoiceLines);
    const creditNote = computeDocumentTotals(invoiceLines.map(negateLineAmounts));
    expect(invoice.totalTtc + creditNote.totalTtc).toBe(0);
    expect(invoice.totalHt + creditNote.totalHt).toBe(0);
    expect(invoice.totalTax + creditNote.totalTax).toBe(0);
  });
});

describe('computeDocumentTotals', () => {
  it('additionne les lignes et produit le récapitulatif de TVA par taux', () => {
    const lines = [
      computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 25_000,
        quantity: 120,
        taxRateBps: 2000,
      }),
      computeLineAmounts({ priceMode: 'TTC', unitPriceTtc: 1_100, quantity: 10, taxRateBps: 1000 }),
      computeLineAmounts({ priceMode: 'TTC', unitPriceTtc: 48_000, quantity: 1, taxRateBps: 2000 }),
    ];
    const totals = computeDocumentTotals(lines);
    expect(totals).toEqual({
      totalHt: 2_550_000,
      totalTax: 509_000,
      totalTtc: 3_059_000,
      taxBreakdown: [
        { taxRateBps: 1000, baseHt: 10_000, taxAmount: 1_000 },
        { taxRateBps: 2000, baseHt: 2_540_000, taxAmount: 508_000 },
      ],
    });
  });

  it('le total TTC est la somme des TTC des lignes, pas un recalcul depuis le total HT', () => {
    // Trois lignes à 0,10 MAD TTC (20 %) : chaque ligne vaut 0,08 HT + 0,02 TVA.
    const line = computeLineAmounts({
      priceMode: 'TTC',
      unitPriceTtc: 10,
      quantity: 1,
      taxRateBps: 2000,
    });
    const totals = computeDocumentTotals([line, line, line]);
    expect(totals.totalTtc).toBe(30);
    expect(totals.totalHt).toBe(24);
    expect(totals.totalTax).toBe(6);
    // Recalculer depuis le total HT donnerait 24 × 1,2 = 28,8 → 29 : un centime perdu.
    expect(htToTtc(totals.totalHt, 2000)).toBe(29);
  });

  it('retourne des totaux nuls pour un document vide', () => {
    expect(computeDocumentTotals([])).toEqual({
      totalHt: 0,
      totalTax: 0,
      totalTtc: 0,
      taxBreakdown: [],
    });
  });
});

describe('formatTaxRate', () => {
  it('affiche un taux lisible', () => {
    expect(formatTaxRate(2000)).toBe('20 %');
    expect(formatTaxRate(550)).toBe('5.50 %');
  });
});
