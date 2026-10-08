import { describe, expect, it } from 'vitest';

import {
  computeDocumentTotals,
  computeLineAmounts,
  computeTax,
  divideAndRound,
  formatTaxRate,
  htToTtc,
  negateLineAmounts,
  resolveTaxRate,
  toStoredPriceHt,
  ttcToHt,
} from './money';

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

describe('computeTax / htToTtc', () => {
  it('calcule la TVA à 20 %', () => {
    expect(computeTax(10_000, 2000)).toBe(2_000);
    expect(htToTtc(10_000, 2000)).toBe(12_000);
  });

  it('arrondit la TVA au centime', () => {
    // 0,25 € × 20 % = 0,05 ; 0,33 × 20 % = 0,066 → 0,07 ; 0,32 × 20 % = 0,064 → 0,06
    expect(computeTax(25, 2000)).toBe(5);
    expect(computeTax(33, 2000)).toBe(7);
    expect(computeTax(32, 2000)).toBe(6);
  });

  it('gère les taux réduits marocains (7, 10, 14 %)', () => {
    expect(computeTax(10_000, 700)).toBe(700);
    expect(computeTax(10_000, 1000)).toBe(1_000);
    expect(computeTax(10_000, 1400)).toBe(1_400);
  });

  it('retourne 0 pour un taux nul', () => {
    expect(htToTtc(12_345, 0)).toBe(12_345);
  });

  it('refuse un taux hors bornes', () => {
    expect(() => computeTax(100, -1)).toThrow(RangeError);
    expect(() => computeTax(100, 10_001)).toThrow(RangeError);
  });
});

describe('ttcToHt', () => {
  it('convertit un TTC rond en HT', () => {
    expect(ttcToHt(12_000, 2000)).toBe(10_000);
    expect(ttcToHt(35_000, 2000)).toBe(29_167);
  });

  it('à 20 % (et 0 %), redonne exactement tout TTC multiple de 0,10 MAD (0 à 10 000 MAD)', () => {
    // À 20 %, seuls les TTC impairs multiples de 3 centimes (0,03 ; 0,09…) sont inatteignables.
    for (const rate of [0, 2000]) {
      for (let ttc = 0; ttc <= 1_000_000; ttc += 10) {
        if (htToTtc(ttcToHt(ttc, rate), rate) !== ttc) {
          throw new Error(`TTC ${ttc} non restitué au taux ${rate}`);
        }
      }
    }
  });

  it('aux taux réduits, l’écart de restitution ne dépasse jamais un centime', () => {
    // Limite connue du stockage HT en centimes : à 10 %, 12,00 TTC → 10,91 HT → 12,00 ;
    // mais à 7 %, 12,00 TTC n'est atteint par aucun HT entier (11,21 → 11,99 ; 11,22 → 12,01).
    for (const rate of [700, 1000, 1400]) {
      for (let ttc = 0; ttc <= 1_000_000; ttc += 1) {
        if (Math.abs(htToTtc(ttcToHt(ttc, rate), rate) - ttc) > 1) {
          throw new Error(`Écart > 1 centime pour TTC ${ttc} au taux ${rate}`);
        }
      }
    }
    expect(htToTtc(ttcToHt(1_200, 700), 700)).toBe(1_199);
  });

  it('reste à un centime près pour un TTC inatteignable', () => {
    // 0,03 MAD à 20 % : HT 0,02 → 0,02 ; HT 0,03 → 0,04. Aucun HT ne donne 0,03.
    const ht = ttcToHt(3, 2000);
    expect(Math.abs(htToTtc(ht, 2000) - 3)).toBeLessThanOrEqual(1);
  });
});

describe('toStoredPriceHt / resolveTaxRate', () => {
  it('stocke tel quel un prix saisi HT', () => {
    expect(toStoredPriceHt(10_000, 'HT', 2000)).toBe(10_000);
  });

  it('convertit un prix saisi TTC', () => {
    expect(toStoredPriceHt(12_000, 'TTC', 2000)).toBe(10_000);
  });

  it('applique un taux nul si le traiteur n’est pas assujetti', () => {
    expect(resolveTaxRate({ isVatRegistered: false, defaultTaxRateBps: 2000 }, 1000)).toBe(0);
  });

  it('privilégie le taux de l’article, sinon le taux par défaut', () => {
    const settings = { isVatRegistered: true, defaultTaxRateBps: 2000 };
    expect(resolveTaxRate(settings, 1000)).toBe(1000);
    expect(resolveTaxRate(settings, null)).toBe(2000);
  });
});

describe('computeLineAmounts', () => {
  it('calcule HT, TVA et TTC d’une ligne', () => {
    expect(computeLineAmounts({ unitPriceHt: 15_000, quantity: 3, taxRateBps: 2000 })).toEqual({
      unitPriceHt: 15_000,
      quantity: 3,
      discountHt: 0,
      taxRateBps: 2000,
      totalHt: 45_000,
      taxAmount: 9_000,
      totalTtc: 54_000,
    });
  });

  it('applique la remise avant la TVA', () => {
    const line = computeLineAmounts({
      unitPriceHt: 10_000,
      quantity: 2,
      discountHt: 1_000,
      taxRateBps: 2000,
    });
    expect(line.totalHt).toBe(19_000);
    expect(line.taxAmount).toBe(3_800);
    expect(line.totalTtc).toBe(22_800);
  });

  it('arrondit la TVA sur le total de la ligne, pas sur le prix unitaire', () => {
    // 3 × 0,33 = 0,99 HT → TVA 0,198 → 0,20 (et non 3 × 0,07 = 0,21)
    const line = computeLineAmounts({ unitPriceHt: 33, quantity: 3, taxRateBps: 2000 });
    expect(line.taxAmount).toBe(20);
    expect(line.totalTtc).toBe(119);
  });

  it('refuse une quantité nulle et une remise supérieure à la ligne', () => {
    expect(() => computeLineAmounts({ unitPriceHt: 100, quantity: 0, taxRateBps: 0 })).toThrow();
    expect(() =>
      computeLineAmounts({ unitPriceHt: 100, quantity: 1, discountHt: 101, taxRateBps: 0 }),
    ).toThrow();
  });

  it('gère les lignes négatives d’un avoir', () => {
    const line = computeLineAmounts({ unitPriceHt: -33, quantity: 3, taxRateBps: 2000 });
    expect(line).toMatchObject({ totalHt: -99, taxAmount: -20, totalTtc: -119 });
  });
});

describe('computeDocumentTotals', () => {
  it('additionne les lignes arrondies et ventile la TVA par taux', () => {
    const lines = [
      computeLineAmounts({ unitPriceHt: 33, quantity: 3, taxRateBps: 2000 }),
      computeLineAmounts({ unitPriceHt: 33, quantity: 3, taxRateBps: 2000 }),
      computeLineAmounts({ unitPriceHt: 10_000, quantity: 1, taxRateBps: 1000 }),
    ];
    expect(computeDocumentTotals(lines)).toEqual({
      totalHt: 10_198,
      totalTax: 1_040,
      totalTtc: 11_238,
      taxBreakdown: [
        { taxRateBps: 1000, baseHt: 10_000, taxAmount: 1_000 },
        { taxRateBps: 2000, baseHt: 198, taxAmount: 40 },
      ],
    });
  });

  it('retourne des totaux nuls pour un document vide', () => {
    expect(computeDocumentTotals([])).toEqual({
      totalHt: 0,
      totalTax: 0,
      totalTtc: 0,
      taxBreakdown: [],
    });
  });

  it('un avoir total annule exactement la facture', () => {
    const invoiceLines = [
      computeLineAmounts({ unitPriceHt: 29_167, quantity: 150, taxRateBps: 2000 }),
      computeLineAmounts({
        unitPriceHt: 125_000,
        quantity: 1,
        discountHt: 5_000,
        taxRateBps: 2000,
      }),
    ];
    const invoice = computeDocumentTotals(invoiceLines);
    const creditNote = computeDocumentTotals(invoiceLines.map(negateLineAmounts));
    expect(invoice.totalTtc + creditNote.totalTtc).toBe(0);
    expect(invoice.totalTax + creditNote.totalTax).toBe(0);
  });
});

describe('formatTaxRate', () => {
  it('affiche un taux lisible', () => {
    expect(formatTaxRate(2000)).toBe('20 %');
    expect(formatTaxRate(550)).toBe('5.50 %');
  });
});
