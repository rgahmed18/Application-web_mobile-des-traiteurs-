import { aggregate, preparationItems } from './preparation-sheet';

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

describe('bon de préparation', () => {
  const items = preparationItems({
    items: [
      // Formule : 2 briouates et 1 pastilla par personne, pour 100 invités
      {
        itemType: 'PACKAGE',
        label: { fr: 'Formule Prestige' },
        quantity: 100,
        dishId: null,
        dish: null,
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
        itemType: 'DISH',
        label: { fr: 'Briouates', ar: 'بريوات' },
        quantity: 50,
        dishId: 'd2',
        dish: briouates,
        package: null,
      },
      {
        itemType: 'CUSTOM',
        label: { fr: 'Gâteau' },
        quantity: 1,
        dishId: null,
        dish: null,
        package: null,
      },
      // Services : pas en cuisine
      {
        itemType: 'EXTRA_SERVICE',
        label: { fr: 'Serveurs' },
        quantity: 4,
        dishId: null,
        dish: null,
        package: null,
      },
    ],
  });

  it('décompose les formules et cumule les quantités par plat', () => {
    const totals = aggregate(items, 'fr');
    expect(totals.map((item) => [item.label.fr, item.quantity, item.unit])).toEqual([
      ['Briouates', 250, 'PER_PIECE'],
      ['Pastilla au poulet', 100, 'PER_PERSON'],
      ['Tajine d’agneau', 100, 'PER_PERSON'],
      ['Gâteau', 1, 'UNIT'],
    ]);
  });

  it('regroupe par catégorie dans l’ordre du catalogue (sans catégorie : à la fin)', () => {
    const categories = aggregate(items, 'fr').map((item) => item.category?.name.fr ?? null);
    expect(categories).toEqual(['Entrées', 'Entrées', 'Plats', null]);
  });
});
