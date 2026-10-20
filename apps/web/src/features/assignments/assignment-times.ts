import { addDays, type AssignmentRole, type Order } from '@traiteur/shared';

import { formatLocalDate } from '@/lib/format/date';

/** « 2026-10-24 » + « 20:00 » − 2 h → « 2026-10-24T18:00 » (heures locales du traiteur). */
function shift(date: string, time: string, hours: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  let total = h * 60 + m + hours * 60;
  let day = date;
  while (total < 0) {
    total += 24 * 60;
    day = addDays(day, -1);
  }
  while (total >= 24 * 60) {
    total -= 24 * 60;
    day = addDays(day, 1);
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day}T${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Horaires proposés : chauffeur avant l'événement, équipe sur toute sa durée. */
export function defaultTimes(
  order: Order,
  role: AssignmentRole,
): { startsAt: string; endsAt: string } {
  const endDate = order.endsNextDay ? addDays(order.eventDate, 1) : order.eventDate;
  const eventEnd = order.endTime
    ? `${endDate}T${order.endTime}`
    : shift(order.eventDate, order.startTime, 5);
  if (role === 'DRIVER') {
    return {
      startsAt: shift(order.eventDate, order.startTime, -3),
      endsAt: shift(order.eventDate, order.startTime, -0.5),
    };
  }
  return {
    startsAt: shift(order.eventDate, order.startTime, role === 'WAITER' ? -1 : -6),
    endsAt: eventEnd,
  };
}

/** « 24/10/2026 19:00 » */
export const formatMoment = (value: { date: string; time: string }) =>
  `${formatLocalDate(value.date)} ${value.time}`;

/** Rôles sur l'événement qui peuvent encaisser à la livraison. */
export const CASH_ROLES: readonly AssignmentRole[] = ['DRIVER', 'SUPERVISOR'];
