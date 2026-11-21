import { describe, expect, it } from 'vitest';

import { commonEventType, outsideMenuLimits, typeMismatch } from './request-checks';

const menu = (
  id: string,
  eventTypes: string[],
  minGuests = 1,
  maxGuests: number | null = null,
) => ({
  id,
  eventTypes,
  minGuests,
  maxGuests,
});

describe('cohérence de la demande', () => {
  it('type prérempli : toutes les formules prévues pour le même type', () => {
    expect(commonEventType([menu('a', ['WEDDING']), menu('b', ['WEDDING'])])).toBe('WEDDING');
    expect(commonEventType([menu('a', ['WEDDING']), menu('b', ['WEDDING', 'ENGAGEMENT'])])).toBe(
      'WEDDING',
    );
    // Formule pour tous les événements : ne contraint pas
    expect(commonEventType([menu('a', ['AQIQA']), menu('b', [])])).toBe('AQIQA');
  });

  it('pas de préremplissage : types différents, plusieurs possibles ou aucune formule typée', () => {
    expect(commonEventType([menu('a', ['WEDDING']), menu('b', ['AQIQA'])])).toBeNull();
    expect(commonEventType([menu('a', ['WEDDING', 'ENGAGEMENT'])])).toBeNull();
    expect(commonEventType([menu('a', [])])).toBeNull();
    expect(commonEventType([])).toBeNull();
  });

  it('avertissement : Aqiqa choisie avec une formule de mariage', () => {
    const wedding = menu('essentiel', ['WEDDING']);
    expect(typeMismatch([wedding], 'AQIQA')).toEqual({ menu: wedding, expected: ['WEDDING'] });
    expect(typeMismatch([wedding], 'WEDDING')).toBeNull();
    expect(typeMismatch([menu('tous', [])], 'AQIQA')).toBeNull();
  });

  it('limites d’un menu (80 à 600) : simple avertissement hors limites', () => {
    const premium = menu('premium', ['WEDDING'], 80, 600);
    expect(outsideMenuLimits([premium], 50)).toEqual([premium]);
    expect(outsideMenuLimits([premium], 80)).toEqual([]);
    expect(outsideMenuLimits([premium], 601)).toEqual([premium]);
    expect(outsideMenuLimits([menu('libre', [], 10, null)], 4000)).toEqual([]);
  });
});
