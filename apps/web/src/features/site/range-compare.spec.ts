import type { PublicMenu, PublicRange } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import { addedLines, comparableEventTypes, compareRanges, upgradeFor } from './range-compare';

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

  it('par gamme : prix « à partir de », plats, menu le moins cher ; menu sans type compris', () => {
    const columns = compareRanges(catalog, RANGES, 'WEDDING');
    expect(columns.map((column) => column.range.code)).toEqual(['STANDARD', 'PREMIUM', 'LUXE']);
    expect(columns[1]).toMatchObject({
      menu: premium,
      fromPrice: 36000,
      dishes: { min: 6, max: 7 },
      menuCount: 2,
    });
  });

  it('gamme sans menu pour ce type : absente ; comparable dès deux gammes', () => {
    expect(compareRanges(catalog, RANGES, 'AQIQA').map((column) => column.range.code)).toEqual([
      'STANDARD',
      'LUXE',
    ]);
    expect(compareRanges({ menus: [aqiqa] }, RANGES, 'AQIQA')).toHaveLength(1);
    // Soutenance : seul le menu Luxe (tous événements) convient
    expect(comparableEventTypes(catalog, RANGES, ['WEDDING', 'AQIQA', 'THESIS'])).toEqual([
      'WEDDING',
      'AQIQA',
    ]);
    expect(comparableEventTypes({ menus: [essentiel, premium] }, RANGES, ['AQIQA'])).toEqual([]);
  });

  it('montée en gamme : gamme juste au-dessus, même événement, supplément positif', () => {
    const upgrade = upgradeFor(catalog, RANGES, essentiel, () => false);
    expect(upgrade).toMatchObject({ to: premium, range: PREMIUM, extraPerPerson: 8000 });
    // Déjà dans la demande : l'autre menu de la gamme
    expect(upgradeFor(catalog, RANGES, essentiel, (id) => id === premium.id)?.to).toBe(premiumBig);
    // Gamme la plus haute, sans gamme ou sans menu équivalent : aucune suggestion
    expect(upgradeFor(catalog, RANGES, luxe, () => false)).toBeNull();
    expect(upgradeFor(catalog, RANGES, menu(null, 1000, ['WEDDING']), () => false)).toBeNull();
    expect(upgradeFor(catalog, RANGES, aqiqa, () => false)).toBeNull();
    // Jamais moins cher
    const cheaper = menu(PREMIUM, 20000, ['WEDDING']);
    expect(upgradeFor({ menus: [essentiel, cheaper] }, RANGES, essentiel, () => false)).toBeNull();
  });

  it('lignes ajoutées par la gamme supérieure', () => {
    expect(addedLines(['Service', 'Thé'], ['service', 'Vaisselle dorée'])).toEqual([
      'Vaisselle dorée',
    ]);
  });
});
