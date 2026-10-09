import {
  computePaymentSchedule,
  type PaymentSchedule,
  todayInTimeZone,
  utcToZoned,
} from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

export interface PaymentTotals {
  /** Encaissements (hors remboursements et encaissements annulés). */
  received: number;
  refunded: number;
  /** Payé net = encaissé − remboursé. */
  net: number;
}

export const NO_PAYMENT: PaymentTotals = { received: 0, refunded: 0, net: 0 };

/** Encaissements pris en compte : réussis et non annulés. */
export const COUNTED_PAYMENT: Prisma.PaymentWhereInput = { status: 'SUCCEEDED', voidedAt: null };

/** Totaux des paiements de plusieurs commandes, en une requête. */
export async function paymentTotals(
  db: Db,
  traiteurId: string,
  orderIds: readonly string[],
): Promise<Map<string, PaymentTotals>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db.payment.groupBy({
    by: ['orderId', 'type'],
    where: { traiteurId, orderId: { in: [...orderIds] }, ...COUNTED_PAYMENT },
    _sum: { amount: true },
  });
  const totals = new Map<string, PaymentTotals>();
  for (const row of rows) {
    const current = totals.get(row.orderId) ?? { ...NO_PAYMENT };
    const sum = row._sum.amount ?? 0;
    if (row.type === 'REFUND') current.refunded += sum;
    else current.received += sum;
    current.net = current.received - current.refunded;
    totals.set(row.orderId, current);
  }
  return totals;
}

export interface ScheduleSettings {
  timezone: string;
  depositPercentBps: number;
  balanceDueDays: number;
}

export interface ScheduledOrder {
  status: string;
  totalTtc: number;
  depositAmount: number;
  confirmedAt: Date | null;
  eventDate: Date;
}

/** Échéancier d'une commande, dans le fuseau du traiteur. */
export function orderSchedule(
  order: ScheduledOrder,
  settings: ScheduleSettings,
  paidNet: number,
  now: Date = new Date(),
): PaymentSchedule {
  return computePaymentSchedule({
    totalTtc: order.totalTtc,
    depositAmount: order.depositAmount,
    depositPercentBps: settings.depositPercentBps,
    balanceDueDays: settings.balanceDueDays,
    // Une commande en attente (non confirmée) n'a pas encore d'échéance due
    confirmedOn: order.confirmedAt ? utcToZoned(order.confirmedAt, settings.timezone).date : null,
    eventDate: utcToZoned(order.eventDate, settings.timezone).date,
    paid: paidNet,
    today: todayInTimeZone(settings.timezone, now),
    cancelled: order.status === 'CANCELLED',
  });
}

/** Résumé affiché dans les listes : payé, reste, en retard. */
export function paymentSummary(
  order: ScheduledOrder,
  settings: ScheduleSettings,
  totals: PaymentTotals | undefined,
): { paid: number; remaining: number; overdueAmount: number } {
  const schedule = orderSchedule(order, settings, totals?.net ?? 0);
  return {
    paid: totals?.net ?? 0,
    remaining: schedule.remaining,
    overdueAmount: schedule.overdueAmount,
  };
}
