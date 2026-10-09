import { Injectable } from '@nestjs/common';
import {
  addDays,
  AWAITING_ORDER_STATUSES,
  type BlockedDateInput,
  type Calendar,
  type CalendarDay,
  type CalendarQuery,
  type CapacityInput,
  type Dashboard,
  daysBetween,
  FIRM_ORDER_STATUSES,
  isFirmStatus,
  OPEN_FIRM_ORDER_STATUSES,
  startOfMonth,
  startOfNextMonth,
  todayInTimeZone,
  utcToZoned,
  zonedDayRange,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { orderSummaryInclude, toCalendarOrder } from './order-mapper';

const MAX_CALENDAR_DAYS = 93;

/** Jour civil stocké en colonne DATE (minuit UTC, sans fuseau). */
const dateColumn = (date: string) => new Date(`${date}T00:00:00Z`);
const fromDateColumn = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthenticatedUser, query: CalendarQuery): Promise<Calendar> {
    const traiteurId = requireTraiteurId(user);
    if (daysBetween(query.from, query.to) + 1 > MAX_CALENDAR_DAYS) {
      throw appErrors.badRequest('INVALID_PERIOD', `Période limitée à ${MAX_CALENDAR_DAYS} jours`);
    }
    const traiteur = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true, maxEventsPerDay: true },
    });
    const timeZone = traiteur.timezone;
    const start = zonedDayRange(query.from, timeZone).start;
    const end = zonedDayRange(query.to, timeZone).end;

    const [orders, blocked] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          traiteurId,
          eventDate: { gte: start, lt: end },
          status: query.includeCancelled ? { not: 'DRAFT' } : { notIn: ['DRAFT', 'CANCELLED'] },
        },
        include: orderSummaryInclude,
        orderBy: [{ eventDate: 'asc' }, { reference: 'asc' }],
      }),
      this.prisma.blockedDate.findMany({
        where: { traiteurId, date: { gte: dateColumn(query.from), lte: dateColumn(query.to) } },
      }),
    ]);

    const calendarOrders = orders.map((row) => toCalendarOrder(row, timeZone));
    const blockedByDate = new Map(blocked.map((row) => [fromDateColumn(row.date), row.reason]));
    const days: CalendarDay[] = [];
    for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
      const ofDay = calendarOrders.filter((order) => order.date === date);
      days.push({
        date,
        blocked: blockedByDate.has(date),
        blockedReason: blockedByDate.get(date) ?? null,
        firmCount: ofDay.filter((order) => isFirmStatus(order.status)).length,
        pendingCount: ofDay.filter((order) =>
          (AWAITING_ORDER_STATUSES as readonly string[]).includes(order.status),
        ).length,
      });
    }
    return {
      from: query.from,
      to: query.to,
      timeZone,
      capacity: traiteur.maxEventsPerDay,
      days,
      orders: calendarOrders,
    };
  }

  async blockDate(
    user: AuthenticatedUser,
    input: BlockedDateInput,
    client: ClientInfo,
  ): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      await tx.blockedDate.upsert({
        where: { traiteurId_date: { traiteurId, date: dateColumn(input.date) } },
        update: { reason: input.reason },
        create: { traiteurId, date: dateColumn(input.date), reason: input.reason },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'calendar.date_blocked',
          entityType: 'BlockedDate',
          after: { date: input.date, reason: input.reason },
          client,
        },
        tx,
      );
    });
  }

  async unblockDate(user: AuthenticatedUser, date: string, client: ClientInfo): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.blockedDate.deleteMany({
        where: { traiteurId, date: dateColumn(date) },
      });
      if (count === 0) throw appErrors.notFound('NOT_FOUND', 'Cette date n’est pas bloquée');
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'calendar.date_unblocked',
          entityType: 'BlockedDate',
          before: { date },
          client,
        },
        tx,
      );
    });
  }

  async setCapacity(
    user: AuthenticatedUser,
    input: CapacityInput,
    client: ClientInfo,
  ): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.traiteur.findUniqueOrThrow({
        where: { id: traiteurId },
        select: { maxEventsPerDay: true },
      });
      await tx.traiteur.update({
        where: { id: traiteurId },
        data: { maxEventsPerDay: input.maxEventsPerDay },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'calendar.capacity_changed',
          entityType: 'Traiteur',
          entityId: traiteurId,
          before: { maxEventsPerDay: before.maxEventsPerDay },
          after: { maxEventsPerDay: input.maxEventsPerDay },
          client,
        },
        tx,
      );
    });
  }

  /** Cartes du tableau de bord, calculées dans le fuseau du traiteur. */
  async dashboard(user: AuthenticatedUser, now: Date = new Date()): Promise<Dashboard> {
    const traiteurId = requireTraiteurId(user);
    const { timezone: timeZone } = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true },
    });
    const today = todayInTimeZone(timeZone, now);
    const todayRange = zonedDayRange(today, timeZone);
    const weekEnd = zonedDayRange(addDays(today, 7), timeZone).end;
    const monthStart = zonedDayRange(startOfMonth(today), timeZone).start;
    const monthEnd = zonedDayRange(startOfNextMonth(today), timeZone).start;
    const active: Prisma.EnumOrderStatusFilter = { notIn: ['DRAFT', 'CANCELLED'] };

    const [todayRows, next7DaysCount, awaitingCount, toCloseCount, revenue] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          traiteurId,
          status: active,
          eventDate: { gte: todayRange.start, lt: todayRange.end },
        },
        include: orderSummaryInclude,
        orderBy: { eventDate: 'asc' },
      }),
      this.prisma.order.count({
        where: { traiteurId, status: active, eventDate: { gte: todayRange.end, lt: weekEnd } },
      }),
      this.prisma.order.count({
        where: { traiteurId, status: { in: [...AWAITING_ORDER_STATUSES] } },
      }),
      this.prisma.order.count({
        where: {
          traiteurId,
          status: { in: [...OPEN_FIRM_ORDER_STATUSES] },
          eventDate: { lt: todayRange.start },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          traiteurId,
          status: { in: [...FIRM_ORDER_STATUSES] },
          eventDate: { gte: monthStart, lt: monthEnd },
        },
        _sum: { totalTtc: true },
        _count: { _all: true },
      }),
    ]);

    return {
      today,
      todayOrders: todayRows.map((row) => toCalendarOrder(row, timeZone)),
      next7DaysCount,
      awaitingCount,
      toCloseCount,
      monthRevenue: {
        month: utcToZoned(monthStart, timeZone).date.slice(0, 7),
        totalTtc: revenue._sum.totalTtc ?? 0,
        orderCount: revenue._count._all,
      },
    };
  }
}
