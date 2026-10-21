import { describe, expect, it } from 'vitest';

import { buffetInputSchema } from './buffet.schemas';

const DISH = '0b8a2c8e-4f6d-4a39-9c39-6a1f0f0e0a01';
const base = {
  name: { fr: 'Buffet marocain', ar: 'بوفيه مغربي' },
  description: null,
  typeId: null,
  rangeId: null,
  pricingUnit: 'PER_PERSON',
  price: 18_000,
  taxRateBps: null,
  minGuests: 30,
  imageKey: null,
  isActive: true,
  dishes: [{ dishId: DISH, quantity: 2 }],
  freeItems: [{ fr: 'Fruits secs', ar: 'فواكه جافة' }],
};

describe('buffetInputSchema', () => {
  it('accepte plats du catalogue et éléments libres, par personne ou forfait', () => {
    expect(buffetInputSchema.safeParse(base).success).toBe(true);
    expect(buffetInputSchema.safeParse({ ...base, pricingUnit: 'FLAT' }).success).toBe(true);
    expect(buffetInputSchema.safeParse({ ...base, dishes: [] }).success).toBe(true);
    expect(buffetInputSchema.safeParse({ ...base, freeItems: [] }).success).toBe(true);
  });

  it('refuse un buffet vide, un plat en double et une tarification à l’heure', () => {
    const paths = (value: object) =>
      buffetInputSchema.safeParse(value).error?.issues.map((issue) => issue.path.join('.'));
    expect(paths({ ...base, dishes: [], freeItems: [] })).toContain('dishes');
    expect(paths({ ...base, dishes: [base.dishes[0], { dishId: DISH, quantity: 1 }] })).toContain(
      'dishes.1.dishId',
    );
    expect(paths({ ...base, pricingUnit: 'PER_HOUR' })).toContain('pricingUnit');
  });
});
