import { describe, expect, it } from 'vitest';

import { zonedToUtc } from '../time/zoned';
import { occupationPeriod, periodsOverlap } from './equipment.schemas';

/** Événement en heure du Maroc : jour, début, fin éventuelle (le lendemain si plus tôt). */
const event = (day: string, start: string, end: string | null, setup = 12, back = 24) => {
  const startAt = zonedToUtc(day, start, 'Africa/Casablanca');
  let endAt: Date | null = null;
  if (end) {
    endAt = zonedToUtc(day, end, 'Africa/Casablanca');
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86_400_000);
  }
  return occupationPeriod(startAt, endAt, setup, back);
};

describe('occupation du matériel par période', () => {
  it('événement après minuit : occupé jusqu’au retour, le lendemain de la fin', () => {
    // 20:30 → 03:00 le lendemain, 12 h avant, 24 h après
    const period = event('2026-11-14', '20:30', '03:00');
    expect(period.start.toISOString()).toBe('2026-11-14T08:30:00.000Z');
    expect(period.end.toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });

  it('deux événements le même jour sans chevauchement (délais courts)', () => {
    const morning = event('2026-11-14', '09:00', '12:00', 1, 1);
    const evening = event('2026-11-14', '19:00', '23:00', 2, 1);
    expect(periodsOverlap(morning, evening)).toBe(false);
    expect(periodsOverlap(evening, morning)).toBe(false);
  });

  it('chevauchement sur deux jours : le retour du premier recouvre l’installation du second', () => {
    const saturday = event('2026-11-14', '20:00', '02:00');
    const sunday = event('2026-11-15', '20:00', null);
    expect(periodsOverlap(saturday, sunday)).toBe(true);
    // Sans délais, les deux soirées ne se touchent pas
    expect(
      periodsOverlap(
        event('2026-11-14', '20:00', '02:00', 0, 0),
        event('2026-11-15', '20:00', null, 0, 0),
      ),
    ).toBe(false);
  });

  it('bornes exclues : une période qui finit quand l’autre commence ne chevauche pas', () => {
    const first = {
      start: new Date('2026-11-14T08:00:00Z'),
      end: new Date('2026-11-14T12:00:00Z'),
    };
    const next = { start: new Date('2026-11-14T12:00:00Z'), end: new Date('2026-11-14T18:00:00Z') };
    expect(periodsOverlap(first, next)).toBe(false);
  });

  it('heure de fin inconnue : la fin est le début de l’événement', () => {
    const period = event('2026-11-14', '20:00', null, 0, 24);
    expect(period.end.toISOString()).toBe('2026-11-15T20:00:00.000Z');
  });
});
