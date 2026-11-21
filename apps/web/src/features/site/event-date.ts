import {
  addDays,
  type ClientCalendar,
  isoWeekday,
  startOfMonth,
  startOfNextMonth,
} from '@traiteur/shared';

/**
 * Sélecteur de date de la demande : calendrier en jours civils « AAAA-MM-JJ » (jamais d'objet
 * Date du navigateur), donc identique quel que soit le fuseau de l'appareil (Casablanca, Paris,
 * New York…) et à toute heure, même près de minuit.
 */
export type DayStatus = 'available' | 'tooSoon' | 'closed' | 'full';

/** Semaines du mois (lundi → dimanche), jours hors du mois à null. */
export function monthGrid(month: string): (string | null)[][] {
  const first = startOfMonth(`${month}-01`);
  const next = startOfNextMonth(first);
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array.from({ length: isoWeekday(first) - 1 }, () => null);
  for (let day = first; day < next; day = addDays(day, 1)) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0)
    weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return weeks;
}

/** Mois voisin « AAAA-MM ». */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Bornes [premier, dernier jour] d'un mois. */
export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  return { from, to: addDays(startOfNextMonth(from), -1) };
}

/** État d'un jour : trop proche (délai minimum), fermé, complet ou possible. */
export function dayStatus(day: string, calendar: ClientCalendar | undefined): DayStatus {
  if (!calendar) return 'available';
  if (day < calendar.earliest) return 'tooSoon';
  if (calendar.closed.includes(day)) return 'closed';
  if (calendar.full.includes(day)) return 'full';
  return 'available';
}
