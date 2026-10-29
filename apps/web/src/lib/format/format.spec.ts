import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime } from './date';
import { centsToInput, formatAmount, formatMoney, parseAmountToCents } from './money';

describe('formatMoney', () => {
  it('espace insécable entre les milliers en français', () => {
    expect(formatMoney(3_859_951, 'fr')).toBe('38\u00A0599,51\u00A0MAD');
    expect(formatMoney(25_000, 'fr')).toBe('250,00\u00A0MAD');
    expect(formatMoney(5, 'fr')).toBe('0,05\u00A0MAD');
  });

  it('garde les chiffres occidentaux en arabe, montant et « د.م. » isolés', () => {
    expect(formatMoney(3_859_951, 'ar')).toBe('\u206638\u00A0599,51\u2069\u00A0\u2067د.م.\u2069');
  });

  it('isolats seulement, jamais de marque de direction (identique serveur et navigateur)', () => {
    expect(formatMoney(123_456_789, 'ar')).not.toMatch(/[\u200E\u200F\u061C]/);
  });

  it('gère les montants négatifs (avoirs) et les grands montants', () => {
    expect(formatAmount(-3_000_000)).toBe('-30\u00A0000,00');
    expect(formatAmount(123_456_789_00)).toBe('123\u00A0456\u00A0789,00');
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
    // Casablanca : UTC+0 depuis le 20 septembre 2026
    expect(formatDate('2026-11-21T19:00:00Z')).toBe('21/11/2026');
    expect(formatDateTime('2026-11-21T19:00:00Z')).toBe('21/11/2026 19:00');
  });

  it('utilise le fuseau du traiteur et non celui du navigateur', () => {
    // 23h30 UTC le 30/06 = 00h30 le 01/07 à Casablanca (UTC+1 avant le 20 septembre 2026)
    const instant = '2026-06-30T23:30:00Z';
    expect(formatDate(instant, 'Africa/Casablanca')).toBe('01/07/2026');
    expect(formatDate(instant, 'UTC')).toBe('30/06/2026');
  });
});
