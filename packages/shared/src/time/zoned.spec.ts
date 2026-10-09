import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  isoWeekday,
  isValidLocalDate,
  startOfMonth,
  startOfNextMonth,
  startOfWeek,
  todayInTimeZone,
  utcToZoned,
  zonedDayRange,
  zonedToUtc,
} from './zoned';

const CASABLANCA = 'Africa/Casablanca';

describe('fuseau du traiteur', () => {
  it('convertit une heure locale de Casablanca (UTC+1 hors ramadan) en UTC', () => {
    expect(zonedToUtc('2026-10-17', '19:30', CASABLANCA).toISOString()).toBe(
      '2026-10-17T18:30:00.000Z',
    );
    expect(utcToZoned(new Date('2026-10-17T18:30:00Z'), CASABLANCA)).toEqual({
      date: '2026-10-17',
      time: '19:30',
    });
  });

  it('applique le changement d’heure du ramadan (UTC+0)', () => {
    // Ramadan 2026 : environ du 18 février au 19 mars, Casablanca repasse à UTC+0
    expect(zonedToUtc('2026-03-01', '20:00', CASABLANCA).toISOString()).toBe(
      '2026-03-01T20:00:00.000Z',
    );
  });

  it('fait l’aller-retour pour toutes les heures d’une journée', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const time = `${String(hour).padStart(2, '0')}:15`;
      expect(utcToZoned(zonedToUtc('2026-11-05', time, CASABLANCA), CASABLANCA)).toEqual({
        date: '2026-11-05',
        time,
      });
    }
  });

  it('donne les bornes UTC d’un jour civil', () => {
    const { start, end } = zonedDayRange('2026-10-17', CASABLANCA);
    expect(start.toISOString()).toBe('2026-10-16T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-17T23:00:00.000Z');
  });

  it('un événement à 00:30 appartient au jour civil local, pas au jour UTC', () => {
    expect(utcToZoned(new Date('2026-10-16T23:30:00Z'), CASABLANCA).date).toBe('2026-10-17');
    expect(todayInTimeZone(CASABLANCA, new Date('2026-10-16T23:30:00Z'))).toBe('2026-10-17');
  });
});

describe('calendrier civil', () => {
  it('ajoute des jours en traversant mois et années', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('semaine du lundi au dimanche, mois', () => {
    expect(isoWeekday('2026-10-11')).toBe(7); // dimanche
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01');
    expect(startOfNextMonth('2026-12-17')).toBe('2027-01-01');
  });

  it('valide les dates', () => {
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
  });
});
