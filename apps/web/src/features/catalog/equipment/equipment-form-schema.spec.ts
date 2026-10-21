import { describe, expect, it } from 'vitest';

import { EMPTY_EQUIPMENT_FORM, equipmentFormSchema } from './equipment-form-schema';

const filled = {
  ...EMPTY_EQUIPMENT_FORM,
  name: { fr: 'Chaise Napoléon', ar: 'كرسي نابليون' },
  price: '15,00',
  replacementPrice: '450',
  stockQuantity: '200',
};

describe('equipmentFormSchema', () => {
  it('convertit les montants en centimes et le stock en entier', () => {
    expect(equipmentFormSchema.parse(filled)).toMatchObject({
      name: { fr: 'Chaise Napoléon', ar: 'كرسي نابليون' },
      categoryId: null,
      rangeId: null,
      price: 1_500,
      replacementPrice: 45_000,
      stockQuantity: 200,
    });
  });

  it('remplacement vide : non facturé', () => {
    expect(equipmentFormSchema.parse({ ...filled, replacementPrice: '' }).replacementPrice).toBe(0);
  });

  it('refuse un stock négatif ou décimal et un prix manquant', () => {
    const paths = (values: object) =>
      equipmentFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.'));
    expect(paths({ ...filled, stockQuantity: '-3' })).toContain('stockQuantity');
    expect(paths({ ...filled, stockQuantity: '2,5' })).toContain('stockQuantity');
    expect(paths({ ...filled, price: '' })).toContain('price');
  });
});
