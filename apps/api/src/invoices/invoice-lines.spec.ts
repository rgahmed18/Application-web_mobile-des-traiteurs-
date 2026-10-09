import { computeLineAmounts } from '@traiteur/shared';

import {
  cancellationFeeLines,
  copyLines,
  deductionLines,
  depositLines,
  fullCreditLines,
  invoiceTotals,
  partialCreditLines,
  prorate,
  type StoredLine,
} from './invoice-lines';

const stored = (label: string, unitPriceTtc: number, quantity: number, taxRateBps: number) => ({
  ...computeLineAmounts({ priceMode: 'TTC', unitPriceTtc, quantity, taxRateBps }),
  itemType: 'CUSTOM' as const,
  label,
});

// Commande : 20 000,00 à 20 % (repas) + 2 700,00 à 10 % (transport)
const order: StoredLine[] = [
  stored('Repas', 25_000, 80, 2000),
  stored('Transport', 270_000, 1, 1000),
];
const label = (rate: number, several: boolean) =>
  several ? `Acompte (TVA ${rate / 100} %)` : 'Acompte';

describe('prorate', () => {
  it('somme exacte, parts proportionnelles (plus forts restes)', () => {
    expect(prorate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(prorate(681_000, [2_000_000, 270_000])).toEqual([600_000, 81_000]);
    expect(prorate(1, [3, 1])).toEqual([1, 0]);
    expect(prorate(500, [0, 0])).toEqual([0, 0]);
  });
});

describe('lignes de facture', () => {
  it('acompte : une ligne par taux au prorata, total TTC exact', () => {
    const lines = depositLines('TTC', 681_000, order, label);
    expect(lines.map((line) => [line.label, line.taxRateBps, line.totalTtc])).toEqual([
      ['Acompte (TVA 10 %)', 1000, 81_000],
      ['Acompte (TVA 20 %)', 2000, 600_000],
    ]);
    expect(invoiceTotals(lines).totalTtc).toBe(681_000);
  });

  it('acompte en mode HT : base HT déduite du TTC demandé', () => {
    const lines = depositLines('HT', 600_000, [{ taxRateBps: 2000, totalTtc: 2_000_000 }], label);
    expect(lines[0]).toMatchObject({ priceMode: 'HT', totalHt: 500_000, taxAmount: 100_000 });
  });

  it('solde : lignes de la commande moins les acomptes, TVA par taux exacte', () => {
    const deposit = depositLines('TTC', 681_000, order, label);
    const balance = [
      ...copyLines(order),
      ...deductionLines(
        [{ number: 'FAC-2026-00001', lines: deposit }],
        (number) => `Acompte ${number}`,
      ),
    ];
    const totals = invoiceTotals(balance);
    const orderTotals = invoiceTotals(copyLines(order));
    const depositTotals = invoiceTotals(deposit);
    expect(totals.totalTtc).toBe(2_270_000 - 681_000);
    // Acompte + solde = commande, au centime près et par taux
    for (const entry of orderTotals.taxBreakdown) {
      const fromDeposit = depositTotals.taxBreakdown.find(
        (item) => item.taxRateBps === entry.taxRateBps,
      );
      const fromBalance = totals.taxBreakdown.find((item) => item.taxRateBps === entry.taxRateBps);
      expect((fromDeposit?.taxAmount ?? 0) + (fromBalance?.taxAmount ?? 0)).toBe(entry.taxAmount);
      expect((fromDeposit?.baseHt ?? 0) + (fromBalance?.baseHt ?? 0)).toBe(entry.baseHt);
    }
  });

  it('avoir total : exactement l’opposé de la facture', () => {
    const credit = invoiceTotals(fullCreditLines(order));
    const invoice = invoiceTotals(copyLines(order));
    expect(credit.totalTtc).toBe(-invoice.totalTtc);
    expect(credit.totalTax).toBe(-invoice.totalTax);
  });

  it('avoir partiel (remboursement) : montant réparti par taux, négatif', () => {
    const deposit = depositLines('TTC', 681_000, order, label);
    const credit = partialCreditLines('TTC', 400_000, deposit, () => 'Remboursement');
    expect(invoiceTotals(credit).totalTtc).toBe(-400_000);
    expect(credit.every((line) => line.totalTtc < 0)).toBe(true);
  });

  it('frais d’annulation : une ligne TTC au taux choisi', () => {
    const [line] = cancellationFeeLines(204_300, 2000, 'Frais d’annulation');
    expect(line).toMatchObject({ priceMode: 'TTC', totalTtc: 204_300, totalHt: 170_250 });
  });
});
