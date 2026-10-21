import {
  aggregate,
  aggregateEquipment,
  preparationEquipment,
  preparationItems,
} from './preparation-sheet';

const starters = { name: { fr: 'Entrées', ar: 'المقبلات' }, sortOrder: 1 };
const mains = { name: { fr: 'Plats', ar: 'الأطباق' }, sortOrder: 2 };
const dish = (
  id: string,
  fr: string,
  category: typeof starters | null,
  unit: 'PER_PERSON' | 'PER_PIECE' = 'PER_PERSON',
) => ({ id, name: { fr }, unit, category });

const pastilla = dish('d1', 'Pastilla au poulet', starters);
const briouates = dish('d2', 'Briouates', starters, 'PER_PIECE');
const tajine = dish('d3', 'Tajine d’agneau', mains);

/** Ligne sans référence au catalogue (champs complétés par chaque cas). */
const line = {
  dishId: null,
  dish: null,
  package: null,
  equipmentId: null,
  buffet: null,
};

describe('bon de préparation', () => {
  const order = {
    items: [
      // Formule : 2 briouates et 1 pastilla par personne, pour 100 invités
      {
        ...line,
        itemType: 'PACKAGE' as const,
        label: { fr: 'Formule Prestige' },
        quantity: 100,
        package: {
          dishes: [
            { quantity: 1, dish: pastilla },
            { quantity: 2, dish: briouates },
            { quantity: 1, dish: tajine },
          ],
        },
      },
      // Plat commandé en plus : s'ajoute à la formule
      {
        ...line,
        itemType: 'DISH' as const,
        label: { fr: 'Briouates', ar: 'بريوات' },
        quantity: 50,
        dishId: 'd2',
        dish: briouates,
      },
      // Buffet pour 40 personnes : 1 briouate par personne, éléments libres au nombre de la ligne
      {
        ...line,
        itemType: 'BUFFET' as const,
        label: { fr: 'Buffet thé' },
        quantity: 40,
        buffet: {
          freeItems: [{ fr: 'Thé à la menthe', ar: 'أتاي' }],
          dishes: [{ quantity: 1, dish: briouates }],
        },
      },
      { ...line, itemType: 'CUSTOM' as const, label: { fr: 'Gâteau' }, quantity: 1 },
      // Services : pas en cuisine
      { ...line, itemType: 'EXTRA_SERVICE' as const, label: { fr: 'Serveurs' }, quantity: 4 },
      // Matériel : récapitulé à part
      {
        ...line,
        itemType: 'EQUIPMENT' as const,
        label: { fr: 'Chaise Napoléon' },
        quantity: 120,
        equipmentId: 'e1',
      },
      {
        ...line,
        itemType: 'EQUIPMENT' as const,
        label: { fr: 'Chaise Napoléon' },
        quantity: 30,
        equipmentId: 'e1',
      },
    ],
  };
  const items = preparationItems(order);

  it('décompose les formules et les buffets et cumule les quantités par plat', () => {
    const totals = aggregate(items, 'fr');
    expect(totals.map((item) => [item.label.fr, item.quantity, item.unit])).toEqual([
      ['Briouates', 290, 'PER_PIECE'],
      ['Pastilla au poulet', 100, 'PER_PERSON'],
      ['Tajine d’agneau', 100, 'PER_PERSON'],
      ['Gâteau', 1, 'UNIT'],
      ['Thé à la menthe', 40, 'UNIT'],
    ]);
  });

  it('regroupe par catégorie dans l’ordre du catalogue (sans catégorie : à la fin)', () => {
    const categories = aggregate(items, 'fr').map((item) => item.category?.name.fr ?? null);
    expect(categories).toEqual(['Entrées', 'Entrées', 'Plats', null, null]);
  });

  it('récapitule le matériel par article, hors cuisine', () => {
    expect(items.some((item) => item.label.fr === 'Chaise Napoléon')).toBe(false);
    expect(
      aggregateEquipment(preparationEquipment(order), 'fr').map((item) => [
        item.label.fr,
        item.quantity,
      ]),
    ).toEqual([['Chaise Napoléon', 150]]);
  });
});
