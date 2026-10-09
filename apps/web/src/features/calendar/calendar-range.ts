import { addDays, startOfMonth, startOfNextMonth, startOfWeek } from '@traiteur/shared';

export const CALENDAR_VIEWS = ['month', 'week', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export interface CalendarRange {
  from: string;
  to: string;
  /** Jours affichés, dans l'ordre (grille du mois : semaines complètes, lundi en premier). */
  days: string[];
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Période affichée pour une vue et un jour de référence (jours civils du traiteur). */
export function calendarRange(view: CalendarView, anchor: string): CalendarRange {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return { from, to, days: daysBetween(from, to) };
  }
  const monthStart = startOfMonth(anchor);
  const monthEnd = addDays(startOfNextMonth(anchor), -1);
  if (view === 'list')
    return { from: monthStart, to: monthEnd, days: daysBetween(monthStart, monthEnd) };
  // Grille : du lundi précédant le 1er au dimanche suivant le dernier jour du mois
  const from = startOfWeek(monthStart);
  const to = addDays(startOfWeek(monthEnd), 6);
  return { from, to, days: daysBetween(from, to) };
}

/** Jour de référence de la période suivante ou précédente. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === 'week') return addDays(anchor, 7 * direction);
  const monthStart = startOfMonth(anchor);
  return direction === 1 ? startOfNextMonth(anchor) : startOfMonth(addDays(monthStart, -1));
}
