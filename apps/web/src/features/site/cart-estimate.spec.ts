import type { PublicMenu } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import {
  alternativeGroups,
  cartEstimate,
  formatEstimate,
  formatEstimateAmount,
  hesitating,
  lineEstimate,
  menuForEvent,
  totalRange,
} from './cart-estimate';
import { formatMoney } from '@traiteur/shared';

const menu = (id: string, eventTypes: string[]): PublicMenu => ({
  id,
  slug: id,
  name: { fr: id },
  description: null,
  imageUrl: null,
  thumbUrl: null,
  range: null,
  pricePerPersonTtc: 28000,
  minGuests: 1,
  maxGuests: null,
  eventTypes,
  dishes: [],
});

describe('« Ma demande » : estimation', () => {
  const formula = {
    kind: 'menu' as const,
    id: 'essentiel',
    priceTtc: 28000,
    unit: 'perPerson' as const,
  };
  const premium = {
    kind: 'menu' as const,
    id: 'premium',
    priceTtc: 36000,
    unit: 'perPerson' as const,
  };
  const luxe = { kind: 'menu' as const, id: 'luxe', priceTtc: 45000, unit: 'perPerson' as const };
  const chairs = {
    kind: 'equipment' as const,
    id: 'chaises',
    priceTtc: 1500,
    unit: 'perUnit' as const,
  };
  const decoration = {
    kind: 'service' as const,
    id: 'deco',
    priceTtc: 800000,
    unit: 'flat' as const,
  };

  it('par personne × invités, forfait, prix × quantité', () => {
    expect(lineEstimate(formula, 1, 150)).toBe(4_200_000);
    expect(lineEstimate(formula, 1, null)).toBeNull();
    expect(lineEstimate(chairs, 200, null)).toBe(300_000);
    expect(lineEstimate(decoration, 1, 150)).toBe(800_000);
  });

  it('total estimé, seulement quand le nombre d’invités est connu', () => {
    const lines = [
      { entry: formula, quantity: 1 },
      { entry: chairs, quantity: 200 },
    ];
    // Une seule formule : un seul montant
    expect(cartEstimate(lines, 150)).toEqual({ min: 4_500_000, max: 4_500_000 });
    expect(cartEstimate(lines, null)).toBeNull();
    expect(cartEstimate([{ entry: chairs, quantity: 2 }], null)).toEqual({ min: 3000, max: 3000 });
  });

  it('client qui hésite entre trois formules : fourchette, jamais leur somme', () => {
    const lines = [formula, premium, luxe].map((entry) => ({ entry, quantity: 1 }));
    const groups = [['essentiel', 'premium', 'luxe']];
    // 280, 360, 450 MAD × 150 invités : entre 42 000 et 67 500 MAD (et non 163 500)
    expect(cartEstimate(lines, 150, groups)).toEqual({ min: 4_200_000, max: 6_750_000 });
  });

  it('formules en alternative avec du matériel et un service : le reste s’additionne', () => {
    const lines = [
      { entry: formula, quantity: 1 },
      { entry: luxe, quantity: 1 },
      { entry: chairs, quantity: 150 },
      { entry: decoration, quantity: 1 },
    ];
    // Reste : 150 × 15 + 8 000 = 10 250 MAD
    expect(cartEstimate(lines, 150, [['essentiel', 'luxe']])).toEqual({
      min: 4_200_000 + 1_025_000,
      max: 6_750_000 + 1_025_000,
    });
    expect(totalRange([100], [[10, 30], [5]])).toEqual({ min: 115, max: 135 });
  });

  it('montants de la fourchette : « 42 000 » seul (isolé en arabe), puis avec la devise', () => {
    expect(formatEstimateAmount(4_200_000, 'fr', formatMoney)).toBe('42\u202f000');
    expect(formatEstimateAmount(4_200_000, 'ar', formatMoney)).toBe('\u206642\u202f000\u2069');
    expect(formatEstimate(16_350_000, 'ar', formatMoney)).toBe(
      '\u2066163\u202f500\u2069\u00a0\u2067د.م.\u2069',
    );
  });
});

describe('« Ma demande » : une formule par événement', () => {
  const essentiel = menu('essentiel', ['WEDDING']);
  const premium = menu('premium', ['WEDDING']);
  const aqiqa = menu('aqiqa', ['AQIQA']);

  it('formule déjà choisie pour le même événement', () => {
    expect(menuForEvent([essentiel, aqiqa], 'WEDDING', premium.id)).toBe(essentiel);
    expect(menuForEvent([aqiqa], 'WEDDING', premium.id)).toBeNull();
    expect(menuForEvent([premium], 'WEDDING', premium.id)).toBeNull();
    // Formule prévue pour tous les événements : concernée aussi
    expect(menuForEvent([menu('tous', [])], 'WEDDING', premium.id)?.id).toBe('tous');
  });

  it('plusieurs gammes gardées pour un même événement : le client hésite', () => {
    expect(hesitating([essentiel, premium])).toBe(true);
    expect(hesitating([essentiel, aqiqa])).toBe(false);
    expect(hesitating([essentiel])).toBe(false);
    // Groupes : formules d'un même événement (une formule pour tous les événements les relie)
    expect(alternativeGroups([essentiel, premium, aqiqa])).toEqual([['essentiel', 'premium']]);
    expect(alternativeGroups([essentiel, aqiqa, menu('tous', [])])).toEqual([
      ['essentiel', 'aqiqa', 'tous'],
    ]);
    expect(alternativeGroups([essentiel, aqiqa])).toEqual([]);
  });
});
