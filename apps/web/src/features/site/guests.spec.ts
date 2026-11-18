import { describe, expect, it } from 'vitest';

import { clampGuests, parseGuests, storedGuests } from './guests';

describe('nombre d’invités : saisie exacte', () => {
  it('vide : aucun nombre, aucune erreur', () => {
    expect(parseGuests('')).toEqual({ value: null, error: null });
    expect(parseGuests('  ')).toEqual({ value: null, error: null });
  });

  it('entier de 1 à 5 000', () => {
    expect(parseGuests('150')).toEqual({ value: 150, error: null });
    expect(parseGuests(' 1 ')).toEqual({ value: 1, error: null });
    expect(parseGuests('5000')).toEqual({ value: 5000, error: null });
  });

  it('refuse les décimaux, les signes, les lettres et les nombres hors limites', () => {
    for (const text of ['12,5', '12.5', '-3', '1e3', 'cent', '15 0']) {
      expect(parseGuests(text)).toEqual({ value: null, error: 'notInteger' });
    }
    expect(parseGuests('0')).toEqual({ value: null, error: 'outOfRange' });
    expect(parseGuests('5001')).toEqual({ value: null, error: 'outOfRange' });
  });

  it('boutons − / + bornés ; valeur stockée invalide ignorée', () => {
    expect(clampGuests(-9)).toBe(1);
    expect(clampGuests(6000)).toBe(5000);
    expect(storedGuests('150')).toBe(150);
    expect(storedGuests('abc')).toBeNull();
    expect(storedGuests(null)).toBeNull();
  });
});
