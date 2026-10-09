import { describe, expect, it } from 'vitest';

import {
  discountToCents,
  emptyOrderForm,
  type LineFormValues,
  liveTotals,
  orderFormSchema,
} from './order-form-schema';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const DISH = '22222222-2222-4222-8222-222222222222';

const line = (overrides: Partial<LineFormValues> = {}): LineFormValues => ({
  key: 'l1',
  itemType: 'CUSTOM',
  dishId: null,
  packageId: null,
  extraServiceId: null,
  label: 'Gâteau',
  quantity: '1',
  unitPrice: '3000',
  discount: '',
  taxRateBps: '2000',
  perPerson: false,
  notes: '',
  ...overrides,
});

const filled = {
  ...emptyOrderForm('2027-03-20', CLIENT),
  guestCount: '100',
  venueAddress: '8, avenue Hassan II',
  city: 'Casablanca',
  endTime: '02:00',
  endsNextDay: true,
  lines: [
    line({
      itemType: 'DISH',
      dishId: DISH,
      label: 'Pastilla',
      quantity: '100',
      unitPrice: '45',
      perPerson: true,
    }),
    line({ discount: '200' }),
    line({
      label: 'Jus',
      quantity: '100',
      unitPrice: '15',
      taxRateBps: '1000',
      perPerson: true,
      discount: '10 %',
    }),
  ],
};

describe('orderFormSchema', () => {
  it('convertit la saisie vers le schéma de l’API', () => {
    const parsed = orderFormSchema.parse(filled);
    expect(parsed).toMatchObject({
      clientId: CLIENT,
      guestCount: 100,
      endTime: '02:00',
      endsNextDay: true,
      venueName: null,
      lines: [
        {
          itemType: 'DISH',
          dishId: DISH,
          quantity: 100,
          unitPrice: 4_500,
          discount: 0,
          perPerson: true,
        },
        { unitPrice: 300_000, discount: 20_000 },
        // 10 % de 100 × 15,00 = 150,00
        { unitPrice: 1_500, discount: 15_000, taxRateBps: 1000 },
      ],
    });
  });

  it('rejette une fin avant le début le même jour, et des lignes vides hors brouillon', () => {
    const paths = (values: typeof filled) =>
      orderFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(paths({ ...filled, endTime: '18:00', endsNextDay: false })).toContain('endTime');
    expect(paths({ ...filled, lines: [] })).toContain('lines');
    expect(paths({ ...filled, lines: [], status: 'DRAFT' })).toEqual([]);
  });

  it('rejette une remise supérieure au montant de la ligne et une date invalide', () => {
    const paths = (values: typeof filled) =>
      orderFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(paths({ ...filled, lines: [line({ discount: '5000' })] })).toContain('lines.0.discount');
    expect(paths({ ...filled, eventDate: '2027-02-30' })).toContain('eventDate');
  });
});

describe('remises et totaux en direct', () => {
  it('remise en pourcentage ou en montant', () => {
    expect(discountToCents('10 %', 1_500, 100)).toBe(15_000);
    expect(discountToCents('12,5%', 10_000, 1)).toBe(1_250);
    expect(discountToCents('200', 300_000, 1)).toBe(20_000);
    expect(discountToCents('', 300_000, 1)).toBe(0);
    expect(Number.isNaN(discountToCents('150 %', 100, 1))).toBe(true);
  });

  it('totaux identiques au calcul de l’API, lignes incomplètes ignorées', () => {
    const totals = liveTotals('TTC', [...filled.lines, line({ unitPrice: '' })]);
    // 4 500,00 + 2 800,00 + 1 350,00 = 8 650,00 TTC
    expect(totals.totalTtc).toBe(865_000);
    expect(totals.totalHt + totals.totalTax).toBe(totals.totalTtc);
    expect(totals.taxBreakdown.map((entry) => entry.taxRateBps)).toEqual([1000, 2000]);
  });
});
