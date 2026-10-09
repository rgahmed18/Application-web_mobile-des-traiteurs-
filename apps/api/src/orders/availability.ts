import {
  AWAITING_ORDER_STATUSES,
  type Availability,
  FIRM_ORDER_STATUSES,
  zonedDayRange,
} from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

export interface AvailabilitySettings {
  timezone: string;
  maxEventsPerDay: number | null;
}

/**
 * Disponibilité d'un jour du traiteur : date bloquée, commandes fermes (qui consomment la
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
  const { start, end } = zonedDayRange(date, settings.timezone);
  const base: Prisma.OrderWhereInput = {
    traiteurId,
    eventDate: { gte: start, lt: end },
    ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
  };
  const [blocked, firmCount, pendingCount] = await Promise.all([
    db.blockedDate.findUnique({
      where: { traiteurId_date: { traiteurId, date: new Date(`${date}T00:00:00Z`) } },
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

/** Le jour pose-t-il problème (bloqué, ou plus de place pour une commande ferme de plus) ? */
export function hasConflict(availability: Availability): boolean {
  return availability.blocked || availability.full;
}
