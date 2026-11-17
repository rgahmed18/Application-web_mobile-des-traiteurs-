import type { PublicMenu, PublicRange } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import {
  addedLines,
  comparableEventTypes,
  compareRanges,
  estimateTotal,
  highlightFirst,
  orderedRanges,
  upgradeFor,
} from './range-compare';

const range = (code: string, finish: PublicRange['finish']): PublicRange => ({
  code,
  name: { fr: code },
  description: null,
  finish,
  included: { fr: [], ar: [] },
});
const ESSENTIEL = range('STANDARD', 'ivory');
const PREMIUM = range('PREMIUM', 'bronze');
const LUXE = range('LUXE', 'gold');
const RANGES = [ESSENTIEL, PREMIUM, LUXE];

let next = 0;
function menu(
  rangeValue: PublicRange | null,
  price: number,
  eventTypes: string[],
  dishes = 4,
): PublicMenu {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    slug: `menu-${next}`,
    name: { fr: `Menu ${next}` },
    description: null,
    imageUrl: null,
    thumbUrl: null,
    range: rangeValue,
    pricePerPersonTtc: price,
    minGuests: 1,
    maxGuests: null,
    eventTypes,
    dishes: Array.from({ length: dishes }, () => ({ name: { fr: 'Plat' }, quantity: 1 })),
  };
}

describe('comparateur de gammes', () => {
  const essentiel = menu(ESSENTIEL, 28000, ['WEDDING'], 5);
  const premium = menu(PREMIUM, 36000, ['WEDDING'], 6);
  const premiumBig = menu(PREMIUM, 40000, ['WEDDING'], 7);
  const luxe = menu(LUXE, 45000, [], 8);
  const aqiqa = menu(ESSENTIEL, 18000, ['AQIQA'], 4);
  const catalog = { menus: [luxe, premiumBig, essentiel, premium, aqiqa] };

  it('toujours Essentiel → Premium → Luxe, quel que soit l’ordre du traiteur', () => {
    expect(orderedRanges([LUXE, ESSENTIEL, PREMIUM]).map((range) => range.code)).toEqual([
      'STANDARD',
      'PREMIUM',
      'LUXE',
    ]);
    const columns = compareRanges(catalog, [LUXE, PREMIUM, ESSENTIEL], 'WEDDING');
    expect(columns.map((column) => column.range.code)).toEqual(['STANDARD', 'PREMIUM', 'LUXE']);
    expect(columns[1]).toMatchObject({
      menu: premium,
      fromPrice: 36000,
      dishes: { min: 6, max: 7 },
      menuCount: 2,
    });
  });

  it('gamme sans menu pour l’événement : colonne « sur demande », jamais retirée', () => {
    const columns = compareRanges(catalog, RANGES, 'AQIQA');
    expect(columns.map((column) => [column.range.code, column.fromPrice])).toEqual([
      ['STANDARD', 18000],
      ['PREMIUM', null],
      ['LUXE', 45000],
    ]);
    expect(columns[1]).toMatchObject({ menu: null, dishes: null, menuCount: 0 });
  });

  it('comparateur pour chaque événement ayant au moins un menu publié, jamais vide', () => {
    expect(comparableEventTypes(catalog, RANGES, ['WEDDING', 'AQIQA', 'THESIS'])).toEqual([
      'WEDDING',
      'AQIQA',
      'THESIS',
    ]);
    // Sans menu pour tous les événements : seulement ceux qui en ont un
    expect(
      comparableEventTypes({ menus: [essentiel, aqiqa] }, RANGES, ['WEDDING', 'THESIS']),
    ).toEqual(['WEDDING']);
    expect(comparableEventTypes({ menus: [] }, RANGES, ['WEDDING'])).toEqual([]);
  });

  it('estimation selon le nombre d’invités ; gamme mise en avant en premier', () => {
    const columns = compareRanges(catalog, RANGES, 'AQIQA');
    expect(estimateTotal(columns[0]!, 100)).toBe(1_800_000);
    expect(estimateTotal(columns[1]!, 100)).toBeNull();
    expect(highlightFirst(columns, 'PREMIUM').map((column) => column.range.code)).toEqual([
      'PREMIUM',
      'STANDARD',
      'LUXE',
    ]);
    expect(highlightFirst(columns, null)).toBe(columns);
  });

  it('montée en gamme : gamme juste au-dessus, même événement, supplément positif', () => {
    const upgrade = upgradeFor(catalog, RANGES, essentiel, () => false);
    expect(upgrade).toMatchObject({ to: premium, range: PREMIUM, extraPerPerson: 8000 });
    expect(upgradeFor(catalog, RANGES, essentiel, (id) => id === premium.id)?.to).toBe(premiumBig);
    expect(upgradeFor(catalog, RANGES, luxe, () => false)).toBeNull();
    expect(upgradeFor(catalog, RANGES, menu(null, 1000, ['WEDDING']), () => false)).toBeNull();
    expect(upgradeFor(catalog, RANGES, aqiqa, () => false)).toBeNull();
    const cheaper = menu(PREMIUM, 20000, ['WEDDING']);
    expect(upgradeFor({ menus: [essentiel, cheaper] }, RANGES, essentiel, () => false)).toBeNull();
  });

  it('lignes ajoutées par la gamme supérieure', () => {
    expect(addedLines(['Service', 'Thé'], ['service', 'Vaisselle dorée'])).toEqual([
      'Vaisselle dorée',
    ]);
  });
});
