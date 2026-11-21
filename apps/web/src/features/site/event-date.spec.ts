import { afterEach, describe, expect, it, vi } from 'vitest';

import { dayStatus, monthBounds, monthGrid, shiftMonth } from './event-date';

const calendar = {
  earliest: '2026-11-24',
  closed: ['2026-11-30'],
  full: ['2026-11-28'],
};

describe('sélecteur de date de la demande', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('grille de novembre 2026 : commence un dimanche (6 cases vides), 30 jours', () => {
    const grid = monthGrid('2026-11');
    expect(grid[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
    expect(grid.at(-1)?.at(0)).toBe('2026-11-30');
  });

  it('mois voisins et bornes, en traversant l’année', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('jours trop proches (délai minimum), fermés, complets ou possibles', () => {
    expect(dayStatus('2026-11-23', calendar)).toBe('tooSoon');
    expect(dayStatus('2026-11-24', calendar)).toBe('available');
    expect(dayStatus('2026-11-28', calendar)).toBe('full');
    expect(dayStatus('2026-11-30', calendar)).toBe('closed');
  });

  it.each(['Africa/Casablanca', 'Europe/Paris', 'America/New_York'])(
    'fuseau %s, juste avant et après minuit : même grille, mêmes jours',
    (timeZone) => {
      vi.stubEnv('TZ', timeZone);
      for (const instant of ['2026-11-21T23:59:00Z', '2026-11-22T00:01:00Z']) {
        vi.useFakeTimers({ now: new Date(instant) });
        expect(monthGrid('2026-11')[0]?.[6]).toBe('2026-11-01');
        expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
        expect(dayStatus('2026-11-24', calendar)).toBe('available');
        vi.useRealTimers();
      }
    },
  );
});
