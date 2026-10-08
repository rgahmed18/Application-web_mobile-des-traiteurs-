import { describe, expect, it } from 'vitest';

import { dishInputSchema, packageInputSchema } from './catalog.schemas';
import { imageVariantPath } from './media.schemas';
import { numberedSlug, slugify } from './slug';

describe('slugify', () => {
  it.each([
    ['Pastilla au poulet et amandes', 'pastilla-au-poulet-et-amandes'],
    ["Tajine d'agneau aux pruneaux", 'tajine-d-agneau-aux-pruneaux'],
    ['Méchoui — Spécial Aïd', 'mechoui-special-aid'],
    ['  Thé à la menthe  ', 'the-a-la-menthe'],
    ['Œufs brouillés', 'oeufs-brouilles'],
  ])('« %s » → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('utilise la valeur de repli sans caractère latin', () => {
    expect(slugify('بسطيلة', 'plat')).toBe('plat');
  });

  it('limite la longueur', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('numérote les identifiants déjà pris', () => {
    expect(numberedSlug('pastilla', 1)).toBe('pastilla');
    expect(numberedSlug('pastilla', 3)).toBe('pastilla-3');
  });
});

const validDish = {
  name: { fr: 'Pastilla', ar: 'بسطيلة' },
  description: null,
  categoryId: null,
  price: 4_500,
  taxRateBps: null,
  unit: 'PER_PERSON',
  minQuantity: 1,
  allergens: ['gluten', 'nuts'],
  imageKey: null,
  isAvailable: true,
};

describe('dishInputSchema', () => {
  it('accepte un plat complet', () => {
    expect(dishInputSchema.safeParse(validDish).success).toBe(true);
  });

  it('refuse un prix négatif ou décimal', () => {
    expect(dishInputSchema.safeParse({ ...validDish, price: -1 }).success).toBe(false);
    expect(dishInputSchema.safeParse({ ...validDish, price: 10.5 }).success).toBe(false);
  });

  it('refuse un allergène inconnu et une photo qui n’est pas une clé de l’API', () => {
    expect(dishInputSchema.safeParse({ ...validDish, allergens: ['pollen'] }).success).toBe(false);
    expect(
      dishInputSchema.safeParse({ ...validDish, imageKey: 'https://exemple.com/photo.jpg' })
        .success,
    ).toBe(false);
  });
});

describe('packageInputSchema', () => {
  const dishId = '11111111-1111-4111-8111-111111111111';
  const validPackage = {
    name: { fr: 'Formule Fiançailles' },
    description: null,
    pricePerPerson: 25_000,
    taxRateBps: null,
    minGuests: 50,
    maxGuests: 300,
    imageKey: null,
    isActive: true,
    dishes: [{ dishId, quantity: 1 }],
  };

  it('accepte une formule valide', () => {
    expect(packageInputSchema.safeParse(validPackage).success).toBe(true);
  });

  it('refuse un maximum d’invités inférieur au minimum', () => {
    const result = packageInputSchema.safeParse({ ...validPackage, maxGuests: 10 });
    expect(result.error?.issues[0]?.path).toEqual(['maxGuests']);
  });

  it('refuse un plat en double et une formule vide', () => {
    expect(
      packageInputSchema.safeParse({
        ...validPackage,
        dishes: [
          { dishId, quantity: 1 },
          { dishId, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(packageInputSchema.safeParse({ ...validPackage, dishes: [] }).success).toBe(false);
  });
});

describe('imageVariantPath', () => {
  it('construit le chemin public des variantes', () => {
    expect(imageVariantPath('traiteurs/a/catalog/b', 'thumb')).toBe(
      'traiteurs/a/catalog/b-400.webp',
    );
  });
});
