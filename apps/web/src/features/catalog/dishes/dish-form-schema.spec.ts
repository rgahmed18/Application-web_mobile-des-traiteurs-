import type { CatalogSettings, Dish } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import { dishFormSchema, dishToFormValues, EMPTY_DISH_FORM } from './dish-form-schema';

const settings: CatalogSettings = {
  priceEntryMode: 'TTC',
  isVatRegistered: true,
  defaultTaxRateBps: 2000,
  currency: 'MAD',
  timezone: 'Africa/Casablanca',
};

const filled = {
  ...EMPTY_DISH_FORM,
  name: { fr: '  Pastilla au poulet ', ar: '' },
  price: '45,50',
  minQuantity: '10',
};

describe('dishFormSchema', () => {
  it('convertit la saisie en données de l’API (montant en centimes, arabe facultatif)', () => {
    expect(dishFormSchema.parse(filled)).toEqual({
      name: { fr: 'Pastilla au poulet' },
      description: null,
      categoryId: null,
      price: 4_550,
      taxRateBps: null,
      unit: 'PER_PERSON',
      minQuantity: 10,
      allergens: [],
      imageKey: null,
      isAvailable: true,
    });
  });

  it('garde l’arabe et la description quand ils sont saisis', () => {
    const result = dishFormSchema.parse({
      ...filled,
      name: { fr: 'Harira', ar: 'حريرة' },
      description: { fr: 'Soupe', ar: '' },
      taxRateBps: '1000',
    });
    expect(result).toMatchObject({
      name: { fr: 'Harira', ar: 'حريرة' },
      description: { fr: 'Soupe' },
      taxRateBps: 1000,
    });
  });

  it('signale les erreurs sur les champs du formulaire, avec les règles partagées', () => {
    const result = dishFormSchema.safeParse({
      ...filled,
      name: { fr: '', ar: '' },
      price: '12,345',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name.fr', 'price']));
  });

  it('refuse une quantité minimale nulle ou vide', () => {
    expect(dishFormSchema.safeParse({ ...filled, minQuantity: '0' }).success).toBe(false);
    expect(dishFormSchema.safeParse({ ...filled, minQuantity: '' }).success).toBe(false);
  });
});

describe('dishToFormValues', () => {
  const dish: Dish = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'pastilla',
    name: { fr: 'Pastilla', ar: 'بسطيلة' },
    description: null,
    categoryId: null,
    priceHt: 20_833,
    priceTtc: 25_000,
    taxRateBps: null,
    effectiveTaxRateBps: 2000,
    unit: 'PER_PERSON',
    minQuantity: 1,
    allergens: ['gluten'],
    imageKey: null,
    isAvailable: true,
    archivedAt: null,
    inUse: false,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
  };

  it('affiche le prix dans le mode du traiteur', () => {
    expect(dishToFormValues(dish, settings).price).toBe('250,00');
    expect(dishToFormValues(dish, { ...settings, priceEntryMode: 'HT' }).price).toBe('208,33');
  });

  it('prépare une copie avec « (copie) » dans les deux langues', () => {
    expect(dishToFormValues(dish, settings, '(copie)').name).toEqual({
      fr: 'Pastilla (copie)',
      ar: 'بسطيلة (copie)',
    });
  });

  it('fait l’aller-retour sans perte', () => {
    expect(dishFormSchema.parse(dishToFormValues(dish, settings))).toMatchObject({
      price: 25_000,
      name: dish.name,
      allergens: dish.allergens,
    });
  });
});
