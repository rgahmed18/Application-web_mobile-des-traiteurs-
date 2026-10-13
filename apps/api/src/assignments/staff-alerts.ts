import type { StaffAlert } from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

/** Délai avant le début d'une mission au-delà duquel une absence de confirmation alerte. */
export const UNCONFIRMED_ALERT_MS = 48 * 60 * 60 * 1000;

/** Commandes concernées : à venir et non annulées. */
const LIVE_ORDER = {
  status: { notIn: ['CANCELLED', 'COMPLETED', 'DELIVERED'] },
} satisfies Prisma.OrderWhereInput;

export interface AlertingAssignment {
  orderId: string;
  status: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Alerte d'une commande : un membre a refusé sa mission (« Je ne peux pas »), ou une mission
 * n'est pas confirmée alors qu'elle commence dans moins de 48 h. Une mission terminée ou passée
 * n'alerte plus.
 */
export function staffAlertOf(
  assignments: readonly AlertingAssignment[],
  now: Date = new Date(),
): StaffAlert | null {
  const live = assignments.filter((assignment) => assignment.endAt > now);
  if (live.some((assignment) => assignment.status === 'DECLINED')) return 'DECLINED';
  const soon = now.getTime() + UNCONFIRMED_ALERT_MS;
  if (
    live.some(
      (assignment) => assignment.status === 'ASSIGNED' && assignment.startAt.getTime() <= soon,
    )
  ) {
    return 'UNCONFIRMED';
  }
  return null;
}

/** Alertes de plusieurs commandes, en une requête. */
export async function staffAlerts(
  db: Db,
  traiteurId: string,
  orderIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, StaffAlert | null>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db.staffAssignment.findMany({
    where: {
      traiteurId,
      orderId: { in: [...orderIds] },
      status: { in: ['ASSIGNED', 'DECLINED'] },
      endAt: { gt: now },
      order: LIVE_ORDER,
    },
    select: { orderId: true, status: true, startAt: true, endAt: true },
  });
  const byOrder = new Map<string, AlertingAssignment[]>();
  for (const row of rows) byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row]);
  return new Map(orderIds.map((id) => [id, staffAlertOf(byOrder.get(id) ?? [], now)]));
}

/** Tableau de bord : missions refusées et missions non confirmées à moins de 48 h. */
export async function staffAlertCounts(
  db: Db,
  traiteurId: string,
  now: Date = new Date(),
): Promise<{ declined: number; unconfirmed: number }> {
  const [declined, unconfirmed] = await Promise.all([
    db.staffAssignment.count({
      where: { traiteurId, status: 'DECLINED', endAt: { gt: now }, order: LIVE_ORDER },
    }),
    db.staffAssignment.count({
      where: {
        traiteurId,
        status: 'ASSIGNED',
        endAt: { gt: now },
        startAt: { lte: new Date(now.getTime() + UNCONFIRMED_ALERT_MS) },
        order: LIVE_ORDER,
      },
    }),
  ]);
  return { declined, unconfirmed };
}
