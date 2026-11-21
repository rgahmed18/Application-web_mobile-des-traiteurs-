import {
  AWAITING_ORDER_STATUSES,
  type Availability,
  FIRM_ORDER_STATUSES,
  addDays,
  daysBetween,
  isoWeekday,
} from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';
import { dayColumn, dayOf } from './event-schedule';

type Db = Prisma.TransactionClient;

export interface AvailabilitySettings {
  timezone: string;
  maxEventsPerDay: number | null;
  closedWeekdays: number[];
}

/**
 * Disponibilité d'un jour du traiteur : date bloquée, fermeture hebdomadaire, commandes fermes (qui consomment la
 * capacité) et commandes en attente (indicatif). Un événement compte uniquement le jour de son
 * début, même s'il se termine après minuit.
 */
export async function dayAvailability(
  db: Db,
  traiteurId: string,
  date: string,
  settings: AvailabilitySettings,
  excludeOrderId?: string,
): Promise<Availability> {
  const base: Prisma.OrderWhereInput = {
    traiteurId,
    // Jour civil de l'événement, tel que saisi (jamais recalculé depuis un instant)
    eventDay: dayColumn(date),
    ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
  };
  const [blocked, firmCount, pendingCount] = await Promise.all([
    db.blockedDate.findUnique({
      where: { traiteurId_date: { traiteurId, date: dayColumn(date) } },
      select: { reason: true },
    }),
    db.order.count({ where: { ...base, status: { in: [...FIRM_ORDER_STATUSES] } } }),
    db.order.count({ where: { ...base, status: { in: [...AWAITING_ORDER_STATUSES] } } }),
  ]);
  const capacity = settings.maxEventsPerDay;
  return {
    date,
    blocked: blocked !== null,
    blockedReason: blocked?.reason ?? null,
    closed: settings.closedWeekdays.includes(isoWeekday(date)),
    capacity,
    firmCount,
    pendingCount,
    full: capacity !== null && firmCount >= capacity,
  };
}

/**
 * Sérialise les contrôles de disponibilité d'un même jour : deux confirmations simultanées
 * ne peuvent pas toutes deux occuper la dernière place. Verrou libéré en fin de transaction.
 */
export async function lockDay(tx: Db, traiteurId: string, date: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${traiteurId}:${date}`}))`;
}

/** Le jour pose-t-il problème (bloqué, fermé, ou plus de place pour une commande ferme) ? */
export function hasConflict(availability: Availability): boolean {
  return availability.blocked || availability.closed || availability.full;
}

/**
 * Jours sans place d'une période [from, to] : fermeture hebdomadaire, date bloquée ou capacité
 * atteinte par les commandes fermes. Pour griser le calendrier du site (sans aucun chiffre).
 */
export async function unavailableDays(
  db: Db,
  traiteurId: string,
  from: string,
  to: string,
  settings: AvailabilitySettings,
): Promise<{ closed: string[]; full: string[] }> {
  const range = { gte: dayColumn(from), lte: dayColumn(to) };
  const [blocked, firm] = await Promise.all([
    db.blockedDate.findMany({ where: { traiteurId, date: range }, select: { date: true } }),
    settings.maxEventsPerDay === null
      ? Promise.resolve([])
      : db.order.groupBy({
          by: ['eventDay'],
          where: { traiteurId, eventDay: range, status: { in: [...FIRM_ORDER_STATUSES] } },
          _count: { _all: true },
        }),
  ]);
  const closed = new Set(blocked.map((row) => dayOf(row.date)));
  for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
    const day = addDays(from, offset);
    if (settings.closedWeekdays.includes(isoWeekday(day))) closed.add(day);
  }
  const capacity = settings.maxEventsPerDay ?? Number.POSITIVE_INFINITY;
  const full = firm
    .filter((row) => row._count._all >= capacity)
    .map((row) => dayOf(row.eventDay))
    .filter((day) => !closed.has(day));
  return { closed: [...closed].sort(), full: full.sort() };
}
