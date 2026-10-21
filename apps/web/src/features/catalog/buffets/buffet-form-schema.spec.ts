import { describe, expect, it } from 'vitest';

import { buffetFormSchema, EMPTY_BUFFET_FORM } from './buffet-form-schema';

const dishId = '0b8a2c8e-4f6d-4a39-9c39-6a1f0f0e0a01';
const filled = {
  ...EMPTY_BUFFET_FORM,
  name: { fr: 'Buffet marocain', ar: 'بوفيه مغربي' },
  price: '180',
  minGuests: '30',
  dishes: [{ dishId, quantity: '2' }],
  freeItems: [
    { fr: 'Fruits secs', ar: 'فواكه جافة' },
    { fr: '  ', ar: '' },
  ],
};

describe('buffetFormSchema', () => {
  it('convertit prix et quantités, ignore les éléments libres vides', () => {
    expect(buffetFormSchema.parse(filled)).toMatchObject({
      price: 18_000,
      minGuests: 30,
      dishes: [{ dishId, quantity: 2 }],
      freeItems: [{ fr: 'Fruits secs', ar: 'فواكه جافة' }],
      typeId: null,
      pricingUnit: 'PER_PERSON',
    });
  });

  it('refuse un buffet sans plat ni élément', () => {
    const result = buffetFormSchema.safeParse({ ...filled, dishes: [], freeItems: [] });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('dishes');
  });
});
