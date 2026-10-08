import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime } from './date';
import { centsToInput, formatAmount, formatMoney, parseAmountToCents } from './money';

describe('formatMoney', () => {
  it('formate au format marocain en français', () => {
    expect(formatMoney(3_859_951, 'fr')).toBe('38.599,51 MAD');
    expect(formatMoney(25_000, 'fr')).toBe('250,00 MAD');
    expect(formatMoney(5, 'fr')).toBe('0,05 MAD');
  });

  it('garde les chiffres occidentaux en arabe, avec « د.م. »', () => {
    expect(formatMoney(3_859_951, 'ar')).toBe('38.599,51 د.م.');
  });

  it('ne contient aucune marque de direction invisible', () => {
    expect(formatMoney(123_456_789, 'ar')).not.toMatch(/[‎‏؜]/);
  });

  it('gère les montants négatifs (avoirs) et les grands montants', () => {
    expect(formatAmount(-3_000_000)).toBe('-30.000,00');
    expect(formatAmount(123_456_789_00)).toBe('123.456.789,00');
  });
});

describe('parseAmountToCents', () => {
  it.each([
    ['250', 25_000],
    ['250,5', 25_050],
    ['250.50', 25_050],
    ['1 250,50', 125_050],
    ['1.250,50', 125_050],
    ['1250', 125_000],
    ['0,05', 5],
    [',5', 50],
    ['1.250', 125_000],
    ['1.250.000', 125_000_000],
    ['-30,00', -3_000],
  ])('lit « %s » comme %i centimes', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '12,345', '1,2,3x', '1.25.0', '12.3456', '-'])('refuse « %s »', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it('fait l’aller-retour avec centsToInput', () => {
    for (const cents of [0, 5, 25_000, 125_050, 3_859_951]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe('formatDate', () => {
  it('formate en JJ/MM/AAAA dans le fuseau du traiteur', () => {
    expect(formatDate('2026-11-21T19:00:00+01:00')).toBe('21/11/2026');
    expect(formatDateTime('2026-11-21T19:00:00+01:00')).toBe('21/11/2026 19:00');
  });

  it('utilise le fuseau du traiteur et non celui du navigateur', () => {
    // 23h30 UTC le 31/12 = 00h30 le 01/01 à Casablanca (UTC+1)
    const instant = '2026-12-31T23:30:00Z';
    expect(formatDate(instant, 'Africa/Casablanca')).toBe('01/01/2027');
    expect(formatDate(instant, 'UTC')).toBe('31/12/2026');
  });
});
