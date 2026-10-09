import {
  type CalendarOrder,
  computeDocumentTotals,
  type Order,
  type OrderLine,
  type OrderSummary,
  utcToZoned,
} from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

export const orderSummaryInclude = {
  client: {
    select: { id: true, firstName: true, lastName: true, user: { select: { phone: true } } },
  },
} satisfies Prisma.OrderInclude;
export type OrderSummaryRow = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;

export const orderInclude = {
  ...orderSummaryInclude,
  items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.OrderInclude;
export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

type ItemRow = OrderRow['items'][number];

/** Jour, heure de début, heure de fin et fin le lendemain, dans le fuseau du traiteur. */
export function toSchedule(
  row: { eventDate: Date; eventEndDate: Date | null },
  timeZone: string,
): { eventDate: string; startTime: string; endTime: string | null; endsNextDay: boolean } {
  const start = utcToZoned(row.eventDate, timeZone);
  const end = row.eventEndDate ? utcToZoned(row.eventEndDate, timeZone) : null;
  return {
    eventDate: start.date,
    startTime: start.time,
    endTime: end?.time ?? null,
    endsNextDay: end !== null && end.date !== start.date,
  };
}

export function toOrderLine(item: ItemRow): OrderLine {
  const ttc = item.priceMode === 'TTC';
  return {
    id: item.id,
    itemType: item.itemType,
    dishId: item.dishId,
    packageId: item.packageId,
    extraServiceId: item.extraServiceId,
    label: item.label,
    quantity: item.quantity,
    unitPrice: ttc ? item.unitPriceTtc : item.unitPriceHt,
    discount: ttc ? item.discountTtc : item.discountHt,
    unitPriceHt: item.unitPriceHt,
    unitPriceTtc: item.unitPriceTtc,
    taxRateBps: item.taxRateBps,
    totalHt: item.totalHt,
    taxAmount: item.taxAmount,
    totalTtc: item.totalTtc,
    perPerson: item.perPerson,
    notes: item.notes,
    sortOrder: item.sortOrder,
  };
}

export function toOrderSummary(row: OrderSummaryRow, timeZone: string): OrderSummary {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    eventType: row.eventType,
    ...toSchedule(row, timeZone),
    eventStart: row.eventDate.toISOString(),
    client: {
      id: row.client.id,
      firstName: row.client.firstName,
      lastName: row.client.lastName,
      phone: row.client.user.phone,
    },
    guestCount: row.guestCount,
    venueName: row.venueName,
    city: row.city,
    priceMode: row.priceMode,
    totalTtc: row.totalTtc,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOrder(row: OrderRow, timeZone: string): Order {
  return {
    ...toOrderSummary(row, timeZone),
    version: row.version,
    eventEnd: row.eventEndDate?.toISOString() ?? null,
    venueAddress: row.venueAddress,
    notes: row.notes,
    internalNotes: row.internalNotes,
    totalHt: row.totalHt,
    totalTax: row.totalTax,
    taxBreakdown: computeDocumentTotals(row.items).taxBreakdown,
    depositAmount: row.depositAmount,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    lines: row.items.map(toOrderLine),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCalendarOrder(row: OrderSummaryRow, timeZone: string): CalendarOrder {
  const schedule = toSchedule(row, timeZone);
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    eventType: row.eventType,
    date: schedule.eventDate,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    endsNextDay: schedule.endsNextDay,
    clientName: `${row.client.firstName} ${row.client.lastName}`.trim(),
    guestCount: row.guestCount,
    city: row.city,
    totalTtc: row.totalTtc,
  };
}
