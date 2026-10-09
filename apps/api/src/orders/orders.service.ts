import { Injectable } from '@nestjs/common';
import {
  addDays,
  type Availability,
  checkOrderEdit,
  checkTransition,
  type Order,
  type OrderCreateInput,
  type OrderFieldGroup,
  type OrderHistoryEntry,
  type OrderLineInput,
  type OrderListQuery,
  type OrderPage,
  type OrderTransitionInput,
  type OrderUpdateInput,
  OPEN_FIRM_ORDER_STATUSES,
  todayInTimeZone,
  utcToZoned,
  zonedDayRange,
  zonedToUtc,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { LineDraft } from '../documents/document-lines';
import { DocumentLinesService } from '../documents/document-lines.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextDocumentNumber } from '../sequences/document-sequence';
import { type AvailabilitySettings, dayAvailability, hasConflict, lockDay } from './availability';
import {
  orderInclude,
  type OrderRow,
  orderSummaryInclude,
  toOrder,
  toOrderLine,
  toOrderSummary,
} from './order-mapper';

type Db = Prisma.TransactionClient;

interface OrderSettings extends AvailabilitySettings {
  priceEntryMode: 'HT' | 'TTC';
  isVatRegistered: boolean;
}

/** Instants UTC du début et de la fin d'un événement saisi dans le fuseau du traiteur. */
function toInstants(
  input: Pick<OrderCreateInput, 'eventDate' | 'startTime' | 'endTime' | 'endsNextDay'>,
  timeZone: string,
): { eventDate: Date; eventEndDate: Date | null } {
  const eventDate = zonedToUtc(input.eventDate, input.startTime, timeZone);
  const eventEndDate =
    input.endTime === null
      ? null
      : zonedToUtc(
          input.endsNextDay ? addDays(input.eventDate, 1) : input.eventDate,
          input.endTime,
          timeZone,
        );
  if (eventEndDate && eventEndDate <= eventDate) {
    throw appErrors.badRequest('VALIDATION_ERROR', 'La fin doit être après le début');
  }
  return { eventDate, eventEndDate };
}

function toDraft(line: OrderLineInput, index: number): LineDraft {
  return {
    itemType: line.itemType,
    label: line.label,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    taxRateBps: line.taxRateBps,
    dishId: line.dishId,
    packageId: line.packageId,
    extraServiceId: line.extraServiceId,
    notes: line.notes,
    perPerson: line.perPerson,
    sortOrder: index,
  };
}

/** Forme comparable d'une ligne (saisie ou enregistrée), pour détecter une modification. */
function lineKey(line: {
  itemType: string;
  dishId: string | null;
  packageId: string | null;
  extraServiceId: string | null;
  label: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRateBps: number;
  perPerson: boolean;
  notes: string | null;
}): string {
  return JSON.stringify([
    line.itemType,
    line.dishId,
    line.packageId,
    line.extraServiceId,
    line.label,
    line.quantity,
    line.unitPrice,
    line.discount,
    line.taxRateBps,
    line.perPerson,
    line.notes ?? null,
  ]);
}

/** Au moins une de ces permissions pour changer un statut (la transition précise la suite). */
const TRANSITION_PERMISSIONS = ['orders.write', 'orders.cancel', 'deliveries.update_status'];

/** Entrées du journal d'audit reprises dans l'historique (les statuts ont leur propre table). */
const HISTORY_ACTIONS = ['order.updated'];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lines: DocumentLinesService,
    private readonly permissions: PermissionsService,
  ) {}

  // ─────────────────────────── Lectures ───────────────────────────

  async list(user: AuthenticatedUser, query: OrderListQuery): Promise<OrderPage> {
    const traiteurId = requireTraiteurId(user);
    const settings = await this.settings(this.prisma, traiteurId);
    const where = this.listWhere(traiteurId, query, settings.timezone);
    const direction = query.direction;
    const orderBy: Prisma.OrderOrderByWithRelationInput[] =
      query.sort === 'createdAt'
        ? [{ createdAt: direction }]
        : query.sort === 'reference'
          ? [{ reference: direction }]
          : [{ eventDate: direction }, { reference: 'asc' }];

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: orderSummaryInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toOrderSummary(row, settings.timezone)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthenticatedUser, id: string): Promise<Order> {
    const traiteurId = requireTraiteurId(user);
    const settings = await this.settings(this.prisma, traiteurId);
    return toOrder(await this.load(this.prisma, traiteurId, id), settings.timezone);
  }

  async availability(
    user: AuthenticatedUser,
    date: string,
    excludeOrderId?: string,
  ): Promise<Availability> {
    const traiteurId = requireTraiteurId(user);
    const settings = await this.settings(this.prisma, traiteurId);
    return dayAvailability(this.prisma, traiteurId, date, settings, excludeOrderId);
  }

  /** Statuts, modifications et passages en force, du plus récent au plus ancien. */
  async history(user: AuthenticatedUser, id: string): Promise<OrderHistoryEntry[]> {
    const traiteurId = requireTraiteurId(user);
    await this.load(this.prisma, traiteurId, id);
    const [changes, audits] = await Promise.all([
      this.prisma.orderStatusChange.findMany({
        where: { traiteurId, orderId: id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { traiteurId, entityType: 'Order', entityId: id, action: { in: HISTORY_ACTIONS } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const names = await this.actorNames(
      traiteurId,
      audits.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
    );
    const entries: OrderHistoryEntry[] = [
      ...changes.map((row): OrderHistoryEntry => ({
        id: row.id,
        kind: row.fromStatus === null ? 'CREATED' : 'STATUS',
        at: row.createdAt.toISOString(),
        actorName: row.actorName,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
        changes: row.availabilityForced ? ['availabilityForced'] : [],
      })),
      ...audits.map((row): OrderHistoryEntry => {
        const after = (row.after ?? {}) as { reason?: unknown; changes?: unknown };
        return {
          id: row.id,
          kind: 'UPDATED',
          at: row.createdAt.toISOString(),
          actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
          fromStatus: null,
          toStatus: null,
          reason: typeof after.reason === 'string' ? after.reason : null,
          changes: Array.isArray(after.changes)
            ? after.changes.filter((item): item is string => typeof item === 'string')
            : [],
        };
      }),
    ];
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }

  // ─────────────────────────── Écritures ───────────────────────────

  async create(
    user: AuthenticatedUser,
    input: OrderCreateInput,
    client: ClientInfo,
  ): Promise<Order> {
    const traiteurId = requireTraiteurId(user);
    // Saisie du back-office (client au choix, notes internes, passage en force) : réservée à
    // l'équipe. Les clients commanderont par leur propre parcours (application client).
    if (user.role === 'CLIENT') {
      throw appErrors.forbidden('FORBIDDEN_ROLE', 'Création réservée à l’équipe du traiteur');
    }
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const clientRow = await tx.membership.findFirst({
        where: { id: input.clientId, traiteurId, role: 'CLIENT', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!clientRow) throw appErrors.notFound('NOT_FOUND', 'Client introuvable');
      await this.assertLines(tx, traiteurId, settings, input.lines, new Set());
      const { eventDate, eventEndDate } = toInstants(input, settings.timezone);

      const forced = await this.checkAvailability(
        tx,
        traiteurId,
        input.eventDate,
        settings,
        input.forceAvailability,
      );

      const number = await nextDocumentNumber(tx, {
        traiteurId,
        type: 'ORDER',
        timeZone: settings.timezone,
      });
      const order = await tx.order.create({
        data: {
          traiteurId,
          reference: number.reference,
          clientId: input.clientId,
          eventType: input.eventType,
          eventDate,
          eventEndDate,
          guestCount: input.guestCount,
          venueName: input.venueName,
          venueAddress: input.venueAddress,
          city: input.city,
          status: input.status,
          priceMode: settings.priceEntryMode,
          notes: input.notes,
          internalNotes: input.internalNotes,
          confirmedAt: input.status === 'CONFIRMED' ? new Date() : null,
        },
      });
      if (input.lines.length > 0) {
        await this.lines.addLines(
          { kind: 'ORDER', id: order.id, traiteurId },
          input.lines.map(toDraft),
          tx,
        );
      }
      await tx.orderStatusChange.create({
        data: {
          traiteurId,
          orderId: order.id,
          fromStatus: null,
          toStatus: input.status,
          availabilityForced: forced !== null,
          actorUserId: user.userId,
          actorName: await this.actorName(tx, traiteurId, user.userId),
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.created',
          entityType: 'Order',
          entityId: order.id,
          after: {
            reference: order.reference,
            status: order.status,
            eventDate: eventDate.toISOString(),
            guestCount: order.guestCount,
            lines: input.lines.length,
          },
          client,
        },
        tx,
      );
      if (forced) await this.recordForced(tx, user, order.id, forced, 'création', client);
      return toOrder(await this.load(tx, traiteurId, order.id), settings.timezone);
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: OrderUpdateInput,
    client: ClientInfo,
  ): Promise<Order> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const current = await this.lockForWrite(tx, traiteurId, id, input.version, settings);
      const { eventDate, eventEndDate } = toInstants(input, settings.timezone);

      // Groupes de champs réellement modifiés, confrontés aux règles du statut
      const changed = new Set<OrderFieldGroup>();
      const changes: string[] = [];
      const mark = (group: OrderFieldGroup, label: string, differs: boolean) => {
        if (!differs) return;
        changed.add(group);
        changes.push(label);
      };
      const currentLines = current.items.map(toOrderLine);
      mark('client', 'client', input.clientId !== current.clientId);
      mark(
        'date',
        'schedule',
        eventDate.getTime() !== current.eventDate.getTime() ||
          (eventEndDate?.getTime() ?? null) !== (current.eventEndDate?.getTime() ?? null),
      );
      mark('framed', 'eventType', input.eventType !== current.eventType);
      mark(
        'framed',
        'venue',
        input.venueAddress !== current.venueAddress || input.city !== current.city,
      );
      mark('framed', 'guests', input.guestCount !== current.guestCount);
      const linesChanged =
        input.lines.length !== currentLines.length ||
        input.lines.some((line, index) => {
          const existing = currentLines[index];
          return !existing || lineKey(line) !== lineKey(existing);
        });
      mark('framed', 'lines', linesChanged);
      mark('free', 'venueName', input.venueName !== current.venueName);
      mark('free', 'notes', input.notes !== current.notes);
      mark('internalNotes', 'internalNotes', input.internalNotes !== current.internalNotes);

      if (changed.size === 0) return toOrder(current, settings.timezone);

      const denial = checkOrderEdit(
        current.status,
        changed,
        await this.permissionsOf(user),
        input.reason,
      );
      if (denial?.denial === 'ORDER_LOCKED') {
        throw appErrors.badRequest(
          'ORDER_LOCKED',
          'Cette modification n’est plus possible pour cette commande',
          {
            field: denial.group,
          },
        );
      }
      if (denial?.denial === 'MISSING_PERMISSION') {
        throw appErrors.forbidden(
          'MISSING_PERMISSION',
          'Permission insuffisante pour modifier une commande confirmée',
        );
      }
      if (denial?.denial === 'REASON_REQUIRED') {
        throw appErrors.badRequest(
          'REASON_REQUIRED',
          'Un motif est obligatoire pour cette modification',
        );
      }
      if (current.status !== 'DRAFT' && input.lines.length === 0) {
        throw appErrors.badRequest('LINES_REQUIRED', 'La commande doit garder au moins une ligne');
      }

      if (changed.has('client')) {
        const exists = await tx.membership.findFirst({
          where: { id: input.clientId, traiteurId, role: 'CLIENT', status: 'ACTIVE' },
          select: { id: true },
        });
        if (!exists) throw appErrors.notFound('NOT_FOUND', 'Client introuvable');
      }
      if (linesChanged) {
        // Un élément archivé reste accepté s'il figurait déjà dans la commande
        const previous = new Set(
          current.items.flatMap((item) => [item.dishId, item.packageId, item.extraServiceId]),
        );
        await this.assertLines(tx, traiteurId, settings, input.lines, previous);
      }

      let forced: Availability | null = null;
      if (changed.has('date')) {
        const newDay = utcToZoned(eventDate, settings.timezone).date;
        forced = await this.checkAvailability(
          tx,
          traiteurId,
          newDay,
          settings,
          input.forceAvailability,
          id,
        );
      }

      await tx.order.update({
        where: { id_traiteurId: { id, traiteurId } },
        data: {
          clientId: input.clientId,
          eventType: input.eventType,
          eventDate,
          eventEndDate,
          guestCount: input.guestCount,
          venueName: input.venueName,
          venueAddress: input.venueAddress,
          city: input.city,
          notes: input.notes,
          internalNotes: input.internalNotes,
        },
      });
      if (linesChanged) {
        await this.lines.replaceLines(
          { kind: 'ORDER', id, traiteurId },
          input.lines.map(toDraft),
          tx,
        );
      }
      const after = await this.load(tx, traiteurId, id);
      if (forced) changes.push('availabilityForced');
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.updated',
          entityType: 'Order',
          entityId: id,
          before: {
            eventDate: current.eventDate.toISOString(),
            eventEndDate: current.eventEndDate?.toISOString() ?? null,
            guestCount: current.guestCount,
            venueAddress: current.venueAddress,
            city: current.city,
            totalTtc: current.totalTtc,
            lines: currentLines.length,
          },
          after: {
            changes,
            reason: input.reason,
            status: current.status,
            eventDate: after.eventDate.toISOString(),
            eventEndDate: after.eventEndDate?.toISOString() ?? null,
            guestCount: after.guestCount,
            venueAddress: after.venueAddress,
            city: after.city,
            totalTtc: after.totalTtc,
            lines: after.items.length,
          },
          client,
        },
        tx,
      );
      if (forced) await this.recordForced(tx, user, id, forced, 'modification', client);
      return toOrder(after, settings.timezone);
    });
  }

  async transition(
    user: AuthenticatedUser,
    id: string,
    input: OrderTransitionInput,
    client: ClientInfo,
  ): Promise<Order> {
    const traiteurId = requireTraiteurId(user);
    const permissions = await this.permissionsOf(user);
    if (!TRANSITION_PERMISSIONS.some((key) => permissions.has(key))) {
      throw appErrors.forbidden('MISSING_PERMISSION', 'Permission insuffisante');
    }
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const current = await this.lockForWrite(tx, traiteurId, id, input.version, settings);
      const from = current.status;
      const check = checkTransition(from, input.to, permissions, input.reason);
      if (!check.ok) {
        if (check.denial === 'MISSING_PERMISSION') {
          throw appErrors.forbidden('MISSING_PERMISSION', 'Permission insuffisante');
        }
        if (check.denial === 'REASON_REQUIRED') {
          throw appErrors.badRequest('REASON_REQUIRED', 'Un motif est obligatoire');
        }
        throw appErrors.badRequest(
          'INVALID_TRANSITION',
          `Passage de ${from} à ${input.to} impossible`,
        );
      }
      if (from === 'DRAFT' && current.items.length === 0) {
        throw appErrors.badRequest('LINES_REQUIRED', 'Ajoutez au moins une ligne à la commande');
      }

      let forced: Availability | null = null;
      if (check.rule.checksAvailability) {
        const day = utcToZoned(current.eventDate, settings.timezone).date;
        forced = await this.checkAvailability(
          tx,
          traiteurId,
          day,
          settings,
          input.forceAvailability,
          id,
        );
      }

      const now = new Date();
      const reason = input.reason?.trim() || null;
      const data: Prisma.OrderUpdateInput = { status: input.to };
      if (input.to === 'CONFIRMED') data.confirmedAt = now;
      if (from === 'CONFIRMED' && input.to === 'PENDING') data.confirmedAt = null;
      if (input.to === 'CANCELLED') {
        data.cancelledAt = now;
        data.cancellationReason = reason;
      }
      await tx.order.update({ where: { id_traiteurId: { id, traiteurId } }, data });
      await tx.orderStatusChange.create({
        data: {
          traiteurId,
          orderId: id,
          fromStatus: from,
          toStatus: input.to,
          reason,
          availabilityForced: forced !== null,
          actorUserId: user.userId,
          actorName: await this.actorName(tx, traiteurId, user.userId),
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.status_changed',
          entityType: 'Order',
          entityId: id,
          before: { status: from },
          after: { status: input.to, reason, availabilityForced: forced !== null },
          client,
        },
        tx,
      );
      if (forced) await this.recordForced(tx, user, id, forced, `${from}→${input.to}`, client);
      return toOrder(await this.load(tx, traiteurId, id), settings.timezone);
    });
  }

  // ─────────────────────────── Interne ───────────────────────────

  private listWhere(
    traiteurId: string,
    query: OrderListQuery,
    timeZone: string,
  ): Prisma.OrderWhereInput {
    const and: Prisma.OrderWhereInput[] = [];
    const search = query.search?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '').replace(/^0+/, '');
      and.push({
        OR: [
          { reference: { contains: search, mode: 'insensitive' } },
          { client: { firstName: { contains: search, mode: 'insensitive' } } },
          { client: { lastName: { contains: search, mode: 'insensitive' } } },
          ...(digits.length >= 3 ? [{ client: { user: { phone: { contains: digits } } } }] : []),
        ],
      });
    }
    if (query.toClose) {
      and.push({
        status: { in: [...OPEN_FIRM_ORDER_STATUSES] },
        eventDate: { lt: zonedDayRange(todayInTimeZone(timeZone), timeZone).start },
      });
    }
    const eventDate: Prisma.DateTimeFilter = {};
    if (query.from) eventDate.gte = zonedDayRange(query.from, timeZone).start;
    if (query.to) eventDate.lt = zonedDayRange(query.to, timeZone).end;
    return {
      traiteurId,
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.from || query.to ? { eventDate } : {}),
      AND: and,
    };
  }

  private async settings(db: Db, traiteurId: string): Promise<OrderSettings> {
    return db.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: {
        timezone: true,
        maxEventsPerDay: true,
        priceEntryMode: true,
        isVatRegistered: true,
      },
    });
  }

  private async load(db: Db, traiteurId: string, id: string): Promise<OrderRow> {
    const row = await db.order.findFirst({ where: { id, traiteurId }, include: orderInclude });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    return row;
  }

  /**
   * Verrouille la commande jusqu'à la fin de la transaction puis vérifie la version lue par
   * l'utilisateur : si quelqu'un l'a modifiée entre-temps, refus 409 avec l'auteur et l'heure.
   */
  private async lockForWrite(
    tx: Db,
    traiteurId: string,
    id: string,
    expectedVersion: number,
    settings: OrderSettings,
  ): Promise<OrderRow> {
    const locked = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "Order"
      WHERE "id" = ${id}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    const version = locked[0]?.version;
    if (version === undefined) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    if (version !== expectedVersion) {
      const last = await tx.auditLog.findFirst({
        where: { traiteurId, entityType: 'Order', entityId: id },
        orderBy: { createdAt: 'desc' },
        select: { actorUserId: true, createdAt: true },
      });
      const modifiedBy = last?.actorUserId
        ? await this.actorName(tx, traiteurId, last.actorUserId)
        : null;
      const time = last ? utcToZoned(last.createdAt, settings.timezone).time : null;
      throw appErrors.conflict(
        'ORDER_VERSION_CONFLICT',
        modifiedBy && time
          ? `Cette commande a été modifiée par ${modifiedBy} à ${time}`
          : 'Cette commande a été modifiée entre-temps',
        { modifiedBy, modifiedAt: last?.createdAt.toISOString() ?? null },
      );
    }
    return this.load(tx, traiteurId, id);
  }

  /**
   * Contrôle de disponibilité : refus 409 (que l'interface présente comme un avertissement)
   * si le jour est bloqué ou complet, sauf si le traiteur a choisi de passer outre.
   * Retourne l'état du jour s'il a été forcé (à tracer), null sinon.
   */
  private async checkAvailability(
    tx: Db,
    traiteurId: string,
    date: string,
    settings: OrderSettings,
    force: boolean,
    excludeOrderId?: string,
  ): Promise<Availability | null> {
    await lockDay(tx, traiteurId, date);
    const availability = await dayAvailability(tx, traiteurId, date, settings, excludeOrderId);
    if (!hasConflict(availability)) return null;
    if (!force) {
      throw appErrors.conflict(
        'AVAILABILITY_CONFLICT',
        availability.blocked ? 'Cette date est bloquée' : 'La capacité de ce jour est atteinte',
        { availability },
      );
    }
    return availability;
  }

  private async recordForced(
    tx: Db,
    user: AuthenticatedUser,
    orderId: string,
    availability: Availability,
    context: string,
    client: ClientInfo,
  ): Promise<void> {
    // Le traiteur a décidé de passer outre une date bloquée ou une capacité atteinte : tracé
    await this.audit.record(
      {
        traiteurId: requireTraiteurId(user),
        actor: user,
        action: 'order.availability_overridden',
        entityType: 'Order',
        entityId: orderId,
        after: { ...availability, context },
        client,
      },
      tx,
    );
  }

  /** Éléments du catalogue référencés : existants chez ce traiteur, non archivés s'ils sont nouveaux. */
  private async assertLines(
    tx: Db,
    traiteurId: string,
    settings: OrderSettings,
    lines: readonly OrderLineInput[],
    previous: ReadonlySet<string | null>,
  ): Promise<void> {
    if (!settings.isVatRegistered && lines.some((line) => line.taxRateBps !== 0)) {
      throw appErrors.badRequest('INVALID_TAX_RATE', 'Établissement non assujetti : TVA à 0 %');
    }
    const ids = (key: 'dishId' | 'packageId' | 'extraServiceId') => [
      ...new Set(lines.flatMap((line) => (line[key] ? [line[key]] : []))),
    ];
    const [dishIds, packageIds, serviceIds] = [
      ids('dishId'),
      ids('packageId'),
      ids('extraServiceId'),
    ];
    const select = { id: true, archivedAt: true } as const;
    const [dishes, packages, services] = await Promise.all([
      tx.dish.findMany({ where: { traiteurId, id: { in: dishIds } }, select }),
      tx.package.findMany({ where: { traiteurId, id: { in: packageIds } }, select }),
      tx.extraService.findMany({ where: { traiteurId, id: { in: serviceIds } }, select }),
    ]);
    const found = [...dishes, ...packages, ...services];
    if (found.length !== dishIds.length + packageIds.length + serviceIds.length) {
      throw appErrors.notFound('NOT_FOUND', 'Élément du catalogue introuvable');
    }
    if (found.some((item) => item.archivedAt && !previous.has(item.id))) {
      throw appErrors.badRequest('ITEM_ARCHIVED', 'Un élément archivé ne peut pas être ajouté');
    }
  }

  private async permissionsOf(user: AuthenticatedUser): Promise<Set<string>> {
    return this.permissions.getEffectivePermissions(
      user.traiteurId,
      user.isSuperAdmin ? 'SUPER_ADMIN' : user.role,
    );
  }

  /** Nom affiché d'un membre de l'équipe (coordonnées chez ce traiteur, sinon compte). */
  private async actorName(db: Db, traiteurId: string, userId: string): Promise<string | null> {
    return (await this.actorNames(traiteurId, [userId], db)).get(userId) ?? null;
  }

  private async actorNames(
    traiteurId: string,
    userIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const [memberships, users] = await Promise.all([
      db.membership.findMany({
        where: { traiteurId, userId: { in: unique } },
        select: { userId: true, firstName: true, lastName: true },
      }),
      db.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const names = new Map(users.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
    for (const row of memberships) names.set(row.userId, `${row.firstName} ${row.lastName}`.trim());
    return names;
  }
}
