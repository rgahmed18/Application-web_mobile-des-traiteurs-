import { describe, expect, it } from 'vitest';

import { compositionValue, EMPTY_PACKAGE_FORM, packageFormSchema } from './package-form-schema';

const dishId = '11111111-1111-4111-8111-111111111111';

describe('packageFormSchema', () => {
  const filled = {
    ...EMPTY_PACKAGE_FORM,
    name: { fr: 'Formule Fiançailles', ar: '' },
    pricePerPerson: '250',
    minGuests: '50',
    maxGuests: '300',
    dishes: [{ dishId, quantity: '2' }],
  };

  it('convertit la saisie (montant, invités, composition)', () => {
    expect(packageFormSchema.parse(filled)).toMatchObject({
      pricePerPerson: 25_000,
      minGuests: 50,
      maxGuests: 300,
      dishes: [{ dishId, quantity: 2 }],
    });
  });

  it('accepte un maximum vide (pas de limite)', () => {
    expect(packageFormSchema.parse({ ...filled, maxGuests: '' }).maxGuests).toBeNull();
  });

  it('applique les règles partagées : maximum ≥ minimum, plat unique, au moins un plat', () => {
    const paths = (values: typeof filled) =>
      packageFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.'));
    expect(paths({ ...filled, maxGuests: '10' })).toContain('maxGuests');
    expect(
      paths({
        ...filled,
        dishes: [
          { dishId, quantity: '1' },
          { dishId, quantity: '1' },
        ],
      }),
    ).toContain('dishes.1.dishId');
    expect(paths({ ...filled, dishes: [] })).toContain('dishes');
  });
});

describe('compositionValue', () => {
  it('additionne prix unitaires × quantités par personne', () => {
    expect(
      compositionValue([
        { unitPrice: 4_500, quantity: '1' },
        { unitPrice: 400, quantity: '3' },
      ]),
    ).toBe(5_700);
  });

  it('ignore une quantité en cours de saisie', () => {
    expect(
      compositionValue([
        { unitPrice: 4_500, quantity: '' },
        { unitPrice: 400, quantity: '2' },
      ]),
    ).toBe(800);
  });

  it('vaut 0 sans plat', () => {
    expect(compositionValue([])).toBe(0);
  });
});
