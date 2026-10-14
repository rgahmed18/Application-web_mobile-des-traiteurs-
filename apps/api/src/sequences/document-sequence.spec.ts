import { getYearInTimeZone } from './document-sequence';

describe('getYearInTimeZone', () => {
  it('retourne l’année dans le fuseau du traiteur', () => {
    // Casablanca : UTC+0 depuis le 20 septembre 2026
    expect(getYearInTimeZone(new Date('2026-12-31T23:30:00Z'), 'Africa/Casablanca')).toBe(2026);
    expect(getYearInTimeZone(new Date('2027-01-01T00:30:00Z'), 'Africa/Casablanca')).toBe(2027);
    // Avant le changement (UTC+1) : 01/01/2026 à 00h30 à Casablanca = 31/12/2025 23h30 UTC
    expect(getYearInTimeZone(new Date('2025-12-31T23:30:00Z'), 'Africa/Casablanca')).toBe(2026);
  });

  it('dépend du fuseau', () => {
    const date = new Date('2026-12-31T23:30:00Z');
    expect(getYearInTimeZone(date, 'UTC')).toBe(2026);
    expect(getYearInTimeZone(date, 'Asia/Dubai')).toBe(2027);
  });
});
