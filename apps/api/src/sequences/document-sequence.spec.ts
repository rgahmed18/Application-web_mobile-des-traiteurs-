import { getYearInTimeZone } from './document-sequence';

describe('getYearInTimeZone', () => {
  it('retourne l’année dans le fuseau du traiteur', () => {
    // 31/12/2026 à 23h30 à Casablanca (UTC+1) = 31/12/2026 22h30 UTC
    expect(getYearInTimeZone(new Date('2026-12-31T22:30:00Z'), 'Africa/Casablanca')).toBe(2026);
    // 01/01/2027 à 00h30 à Casablanca = 31/12/2026 23h30 UTC
    expect(getYearInTimeZone(new Date('2026-12-31T23:30:00Z'), 'Africa/Casablanca')).toBe(2027);
  });

  it('dépend du fuseau', () => {
    const date = new Date('2026-12-31T23:30:00Z');
    expect(getYearInTimeZone(date, 'UTC')).toBe(2026);
    expect(getYearInTimeZone(date, 'Asia/Dubai')).toBe(2027);
  });
});
