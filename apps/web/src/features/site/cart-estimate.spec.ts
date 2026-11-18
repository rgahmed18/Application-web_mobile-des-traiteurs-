import type { PublicMenu } from '@traiteur/shared';
import { describe, expect, it } from 'vitest';

import { cartEstimate, hesitating, lineEstimate, menuForEvent } from './cart-estimate';

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
  const formula = { priceTtc: 28000, unit: 'perPerson' as const };
  const chairs = { priceTtc: 1500, unit: 'perUnit' as const };
  const decoration = { priceTtc: 800000, unit: 'flat' as const };

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
    expect(cartEstimate(lines, 150)).toBe(4_500_000);
    expect(cartEstimate(lines, null)).toBeNull();
    expect(cartEstimate([{ entry: chairs, quantity: 2 }], null)).toBe(3000);
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
  });
});
