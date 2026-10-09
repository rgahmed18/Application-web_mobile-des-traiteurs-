import { describe, expect, it } from 'vitest';

import { calendarRange, shiftAnchor } from './calendar-range';

describe('calendarRange', () => {
  it('mois : semaines complètes du lundi au dimanche', () => {
    const range = calendarRange('month', '2026-10-17');
    expect(range.from).toBe('2026-09-28'); // lundi
    expect(range.to).toBe('2026-11-01'); // dimanche
    expect(range.days).toHaveLength(35);
  });

  it('semaine : du lundi au dimanche', () => {
    expect(calendarRange('week', '2026-10-11')).toMatchObject({
      from: '2026-10-05',
      to: '2026-10-11',
    });
  });

  it('liste : le mois civil', () => {
    expect(calendarRange('list', '2026-02-10')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('navigation entre périodes', () => {
    expect(shiftAnchor('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('week', '2026-10-08', 1)).toBe('2026-10-15');
  });
});
