import { Injectable } from '@nestjs/common';
import {
  addDays,
  type Assignment,
  type AssignmentBatchInput,
  type AssignmentConflict,
  type AssignmentInput,
  type AssignmentLineProblem,
  type AssignmentUpdateInput,
  type OrderStaffing,
  type Planning,
  type PlanningQuery,
  type ServiceInfoInput,
  STAFF_ROLES,
  type StaffMemberRole,
  utcToZoned,
  zonedDayRange,
  zonedToUtc,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CASH_ROLES, latestDeclaration, toDeclaration } from './cash-declaration';
import { staffAlerts } from './staff-alerts';

type Db = Prisma.TransactionClient;

/** Statuts de commande où l'on affecte du personnel. */
const STAFFABLE = ['CONFIRMED', 'IN_PREPARATION', 'OUT_FOR_DELIVERY'];

const assignmentInclude = {
  membership: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      user: { select: { phone: true } },
    },
  },
  payments: latestDeclaration,
} satisfies Prisma.StaffAssignmentInclude;
type AssignmentRow = Prisma.StaffAssignmentGetPayload<{ include: typeof assignmentInclude }>;

/** « 2026-10-24T17:30 » → instant UTC dans le fuseau du traiteur. */
function toInstant(value: string, timeZone: string): Date {
  const [date = '', time = ''] = value.split('T');
  return zonedToUtc(date, time, timeZone);
}

const moment = (instant: Date, timeZone: string) => {
  const zoned = utcToZoned(instant, timeZone);
  return { date: zoned.date, time: zoned.time };
};

/**
 * Affectation du personnel aux événements : membre, rôle sur l'événement, horaires, notes.
 * Un chevauchement avec une autre mission du membre est refusé (409) sauf si le traiteur passe
 * outre (tracé). Le planning présente les missions d'une semaine par personne.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async forOrder(user: AuthenticatedUser, orderId: string): Promise<OrderStaffing> {
    return this.staffing(this.prisma, requireTraiteurId(user), orderId);
  }

  async create(
    user: AuthenticatedUser,
    orderId: string,
    input: AssignmentInput,
    client: ClientInfo,
  ): Promise<OrderStaffing> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const timeZone = await this.lockOrder(tx, traiteurId, orderId);
      this.assertCash(input);
      const member = await tx.membership.findFirst({
        where: { id: input.membershipId, traiteurId, role: { in: [...STAFF_ROLES] } },
        select: { id: true, status: true, firstName: true, lastName: true },
      });
      if (!member) throw appErrors.notFound('NOT_FOUND', 'Membre introuvable');
      if (member.status === 'SUSPENDED') {
        throw appErrors.badRequest('MEMBER_UNAVAILABLE', 'Ce membre est suspendu');
      }
      const existing = await tx.staffAssignment.findFirst({
        where: { orderId, membershipId: member.id, staffRole: input.staffRole },
        select: { id: true },
      });
      if (existing) {
        throw appErrors.conflict('ASSIGNMENT_EXISTS', 'Ce membre a déjà ce rôle sur l’événement');
      }
      const startAt = toInstant(input.startsAt, timeZone);
      const endAt = toInstant(input.endsAt, timeZone);
      const conflicts = await this.conflicts(tx, traiteurId, member.id, startAt, endAt, null);
      this.assertNoConflict(conflicts, input.force, timeZone);
      const created = await tx.staffAssignment.create({
        data: {
          traiteurId,
          orderId,
          membershipId: member.id,
          staffRole: input.staffRole,
          startAt,
          endAt,
          notes: input.notes,
          cashToCollect: input.cashToCollect,
          cashMethod: input.cashMethod,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'assignment.created',
          entityType: 'StaffAssignment',
          entityId: created.id,
          after: {
            orderId,
            memberId: member.id,
            staffRole: input.staffRole,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            overlapForced: conflicts.length > 0,
            cashToCollect: input.cashToCollect,
            cashMethod: input.cashMethod,
          },
          client,
        },
        tx,
      );
    });
    return this.staffing(this.prisma, traiteurId, orderId);
  }

  /**
   * Plusieurs membres en une seule transaction. Toutes les lignes sont contrôlées avant toute
   * écriture : membre, rôle déjà tenu sur l'événement, encaissement, chevauchements (missions
   * enregistrées du membre et autres lignes du lot pour le même membre). Un chevauchement se lève
   * ligne par ligne (« force », tracé) ; sinon 409 ASSIGNMENT_BATCH_CONFLICT avec le problème de
   * chaque ligne, et rien n'est enregistré.
   */
  async createBatch(
    user: AuthenticatedUser,
    orderId: string,
    input: AssignmentBatchInput,
    client: ClientInfo,
  ): Promise<OrderStaffing> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const timeZone = await this.lockOrder(tx, traiteurId, orderId);
      const memberIds = [...new Set(input.lines.map((line) => line.membershipId))];
      const members = await tx.membership.findMany({
        where: { id: { in: memberIds }, traiteurId, role: { in: [...STAFF_ROLES] } },
        select: { id: true, status: true },
      });
      const memberById = new Map(members.map((member) => [member.id, member]));
      const held = new Set(
        (
          await tx.staffAssignment.findMany({
            where: { orderId, membershipId: { in: memberIds } },
            select: { membershipId: true, staffRole: true },
          })
        ).map((row) => `${row.membershipId}:${row.staffRole}`),
      );
      const lines = input.lines.map((line) => ({
        ...line,
        startAt: toInstant(line.startsAt, timeZone),
        endAt: toInstant(line.endsAt, timeZone),
      }));

      const problems: AssignmentLineProblem[] = [];
      const overlapping: boolean[] = [];
      for (const [index, line] of lines.entries()) {
        const reject = (code: AssignmentLineProblem['code']) =>
          problems.push({ index, code, conflicts: [], lines: [] });
        const member = memberById.get(line.membershipId);
        if (!member) reject('MEMBER_NOT_FOUND');
        else if (member.status === 'SUSPENDED') reject('MEMBER_UNAVAILABLE');
        else if (held.has(`${line.membershipId}:${line.staffRole}`)) reject('ASSIGNMENT_EXISTS');
        else if (line.cashToCollect !== null && !CASH_ROLES.includes(line.staffRole)) {
          reject('CASH_NOT_ALLOWED');
        } else {
          const conflicts = await this.conflicts(
            tx,
            traiteurId,
            line.membershipId,
            line.startAt,
            line.endAt,
            null,
          );
          const siblings = lines.flatMap((other, otherIndex) =>
            otherIndex !== index &&
            other.membershipId === line.membershipId &&
            other.startAt < line.endAt &&
            other.endAt > line.startAt
              ? [otherIndex]
              : [],
          );
          overlapping[index] = conflicts.length > 0 || siblings.length > 0;
          if (overlapping[index] && !line.force) {
            problems.push({ index, code: 'OVERLAP', conflicts, lines: siblings });
          }
        }
      }
      if (problems.length > 0) {
        throw appErrors.conflict(
          'ASSIGNMENT_BATCH_CONFLICT',
          'Certaines lignes ne peuvent pas être enregistrées',
          { problems, timeZone },
        );
      }

      for (const [index, line] of lines.entries()) {
        const created = await tx.staffAssignment.create({
          data: {
            traiteurId,
            orderId,
            membershipId: line.membershipId,
            staffRole: line.staffRole,
            startAt: line.startAt,
            endAt: line.endAt,
            notes: line.notes,
            cashToCollect: line.cashToCollect,
            cashMethod: line.cashMethod,
          },
        });
        await this.audit.record(
          {
            traiteurId,
            actor: user,
            action: 'assignment.created',
            entityType: 'StaffAssignment',
            entityId: created.id,
            after: {
              orderId,
              memberId: line.membershipId,
              staffRole: line.staffRole,
              startAt: line.startAt.toISOString(),
              endAt: line.endAt.toISOString(),
              overlapForced: overlapping[index] ?? false,
              cashToCollect: line.cashToCollect,
              cashMethod: line.cashMethod,
              batch: { index, size: lines.length },
            },
            client,
          },
          tx,
        );
      }
    });
    return this.staffing(this.prisma, traiteurId, orderId);
  }

  /** Nouveaux rôle ou horaires : la réponse du membre est remise à zéro. */
  async update(
    user: AuthenticatedUser,
    assignmentId: string,
    input: AssignmentUpdateInput,
    client: ClientInfo,
  ): Promise<OrderStaffing> {
    const traiteurId = requireTraiteurId(user);
    const orderId = await this.prisma.$transaction(async (tx) => {
      const current = await this.findAssignment(tx, traiteurId, assignmentId);
      const timeZone = await this.lockOrder(tx, traiteurId, current.orderId);
      this.assertCash(input);
      const cashChanged =
        current.cashToCollect !== input.cashToCollect || current.cashMethod !== input.cashMethod;
      if (cashChanged) await this.assertNoDeclaration(tx, assignmentId);
      const startAt = toInstant(input.startsAt, timeZone);
      const endAt = toInstant(input.endsAt, timeZone);
      const conflicts = await this.conflicts(
        tx,
        traiteurId,
        current.membershipId,
        startAt,
        endAt,
        assignmentId,
      );
      this.assertNoConflict(conflicts, input.force, timeZone);
      const changed =
        current.staffRole !== input.staffRole ||
        current.startAt.getTime() !== startAt.getTime() ||
        current.endAt.getTime() !== endAt.getTime();
      await tx.staffAssignment.update({
        where: { id: assignmentId },
        data: {
          staffRole: input.staffRole,
          startAt,
          endAt,
          notes: input.notes,
          cashToCollect: input.cashToCollect,
          cashMethod: input.cashMethod,
          // Mission modifiée : le membre doit la confirmer à nouveau
          ...(changed
            ? { status: 'ASSIGNED', respondedAt: null, declineReason: null, doneAt: null }
            : {}),
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'assignment.updated',
          entityType: 'StaffAssignment',
          entityId: assignmentId,
          before: {
            staffRole: current.staffRole,
            startAt: current.startAt.toISOString(),
            endAt: current.endAt.toISOString(),
            cashToCollect: current.cashToCollect,
            cashMethod: current.cashMethod,
          },
          after: {
            staffRole: input.staffRole,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            overlapForced: conflicts.length > 0,
            cashToCollect: input.cashToCollect,
            cashMethod: input.cashMethod,
          },
          client,
        },
        tx,
      );
      return current.orderId;
    });
    return this.staffing(this.prisma, traiteurId, orderId);
  }

  async remove(
    user: AuthenticatedUser,
    assignmentId: string,
    client: ClientInfo,
  ): Promise<OrderStaffing> {
    const traiteurId = requireTraiteurId(user);
    const orderId = await this.prisma.$transaction(async (tx) => {
      const current = await this.findAssignment(tx, traiteurId, assignmentId);
      await this.assertNoDeclaration(tx, assignmentId);
      await tx.staffAssignment.delete({ where: { id: assignmentId } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'assignment.removed',
          entityType: 'StaffAssignment',
          entityId: assignmentId,
          before: {
            orderId: current.orderId,
            memberId: current.membershipId,
            staffRole: current.staffRole,
            status: current.status,
          },
          client,
        },
        tx,
      );
      return current.orderId;
    });
    return this.staffing(this.prisma, traiteurId, orderId);
  }

  /** Contact sur place, notes de service et matériel (jamais montrés au client). */
  async updateServiceInfo(
    user: AuthenticatedUser,
    orderId: string,
    input: ServiceInfoInput,
    client: ClientInfo,
  ): Promise<OrderStaffing> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, traiteurId },
        select: {
          onSiteContactName: true,
          onSiteContactPhone: true,
          serviceNotes: true,
          equipment: true,
        },
      });
      if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
      await tx.order.update({
        where: { id_traiteurId: { id: orderId, traiteurId } },
        data: input,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.service_info_updated',
          entityType: 'Order',
          entityId: orderId,
          before: order,
          after: { ...input },
          client,
        },
        tx,
      );
    });
    return this.staffing(this.prisma, traiteurId, orderId);
  }

  /** Semaine (lundi → dimanche) par personne : missions et chevauchements. */
  async planning(user: AuthenticatedUser, query: PlanningQuery): Promise<Planning> {
    const traiteurId = requireTraiteurId(user);
    const timeZone = await this.timeZone(this.prisma, traiteurId);
    const weekday = new Date(`${query.week}T12:00:00Z`).getUTCDay();
    const weekStart = addDays(query.week, -((weekday + 6) % 7));
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const from = zonedDayRange(weekStart, timeZone).start;
    const to = zonedDayRange(addDays(weekStart, 6), timeZone).end;
    const [members, assignments] = await Promise.all([
      this.prisma.membership.findMany({
        where: { traiteurId, role: { in: [...STAFF_ROLES] }, status: { not: 'SUSPENDED' } },
        select: { id: true, firstName: true, lastName: true, role: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.staffAssignment.findMany({
        where: {
          traiteurId,
          startAt: { lt: to },
          endAt: { gt: from },
          order: { status: { not: 'CANCELLED' } },
        },
        include: { order: { select: { reference: true, eventType: true, city: true } } },
        orderBy: { startAt: 'asc' },
      }),
    ]);
    const live = (status: string) => status !== 'DECLINED';
    return {
      weekStart,
      days,
      members: members.map((member) => {
        const own = assignments.filter((assignment) => assignment.membershipId === member.id);
        return {
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          role: member.role as StaffMemberRole,
          missions: own.map((assignment) => ({
            id: assignment.id,
            orderId: assignment.orderId,
            orderReference: assignment.order.reference,
            eventType: assignment.order.eventType,
            city: assignment.order.city,
            staffRole: assignment.staffRole,
            status: assignment.status,
            start: moment(assignment.startAt, timeZone),
            end: moment(assignment.endAt, timeZone),
            conflict:
              live(assignment.status) &&
              own.some(
                (other) =>
                  other.id !== assignment.id &&
                  live(other.status) &&
                  other.startAt < assignment.endAt &&
                  other.endAt > assignment.startAt,
              ),
          })),
        };
      }),
    };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async staffing(db: Db, traiteurId: string, orderId: string): Promise<OrderStaffing> {
    const order = await db.order.findFirst({
      where: { id: orderId, traiteurId },
      select: {
        onSiteContactName: true,
        onSiteContactPhone: true,
        serviceNotes: true,
        equipment: true,
        traiteur: { select: { timezone: true } },
      },
    });
    if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    const timeZone = order.traiteur.timezone;
    const rows = await db.staffAssignment.findMany({
      where: { traiteurId, orderId },
      include: assignmentInclude,
      orderBy: [{ startAt: 'asc' }, { staffRole: 'asc' }],
    });
    const assignments: Assignment[] = [];
    for (const row of rows) {
      const conflicts =
        row.status === 'DECLINED'
          ? []
          : await this.conflicts(db, traiteurId, row.membershipId, row.startAt, row.endAt, row.id);
      assignments.push(this.toAssignment(row, timeZone, conflicts));
    }
    const alerts = await staffAlerts(db, traiteurId, [orderId]);
    return {
      assignments,
      serviceInfo: {
        onSiteContactName: order.onSiteContactName,
        onSiteContactPhone: order.onSiteContactPhone,
        serviceNotes: order.serviceNotes,
        equipment: order.equipment,
      },
      alert: alerts.get(orderId) ?? null,
    };
  }

  private toAssignment(
    row: AssignmentRow,
    timeZone: string,
    conflicts: AssignmentConflict[],
  ): Assignment {
    return {
      id: row.id,
      orderId: row.orderId,
      member: {
        id: row.membership.id,
        firstName: row.membership.firstName,
        lastName: row.membership.lastName,
        phone: row.membership.user.phone,
        role: row.membership.role as StaffMemberRole,
        status: row.membership.status,
      },
      staffRole: row.staffRole,
      status: row.status,
      start: moment(row.startAt, timeZone),
      end: moment(row.endAt, timeZone),
      notes: row.notes,
      declineReason: row.declineReason,
      respondedAt: row.respondedAt?.toISOString() ?? null,
      cashToCollect: row.cashToCollect,
      cashMethod: row.cashMethod === 'CASH' || row.cashMethod === 'CHEQUE' ? row.cashMethod : null,
      cashDeclaration: toDeclaration(row.payments[0]),
      conflicts,
    };
  }

  /** Autres missions du membre (non refusées, commande non annulée) qui chevauchent. */
  private async conflicts(
    db: Db,
    traiteurId: string,
    membershipId: string,
    startAt: Date,
    endAt: Date,
    excludeId: string | null,
  ): Promise<AssignmentConflict[]> {
    const rows = await db.staffAssignment.findMany({
      where: {
        traiteurId,
        membershipId,
        status: { not: 'DECLINED' },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        order: { status: { not: 'CANCELLED' } },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: { order: { select: { reference: true, traiteur: { select: { timezone: true } } } } },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((row) => ({
      assignmentId: row.id,
      orderId: row.orderId,
      orderReference: row.order.reference,
      start: moment(row.startAt, row.order.traiteur.timezone),
      end: moment(row.endAt, row.order.traiteur.timezone),
    }));
  }

  private assertNoConflict(
    conflicts: AssignmentConflict[],
    force: boolean,
    timeZone: string,
  ): void {
    if (conflicts.length > 0 && !force) {
      throw appErrors.conflict(
        'ASSIGNMENT_CONFLICT',
        'Ce membre est déjà affecté à un autre événement sur ce créneau',
        { conflicts, timeZone },
      );
    }
  }

  /** Un montant à encaisser ne se règle que pour le chauffeur ou le superviseur. */
  private assertCash(input: { staffRole: string; cashToCollect: number | null }): void {
    if (input.cashToCollect !== null && !CASH_ROLES.includes(input.staffRole)) {
      throw appErrors.badRequest(
        'CASH_NOT_ALLOWED',
        'Seul le chauffeur ou le superviseur encaisse à la livraison',
      );
    }
  }

  /** Encaissement déjà déclaré (en attente ou remis) : montant figé, affectation conservée. */
  private async assertNoDeclaration(tx: Db, assignmentId: string): Promise<void> {
    const declared = await tx.payment.count({
      where: { assignmentId, collectedAt: { not: null }, voidedAt: null },
    });
    if (declared > 0) {
      throw appErrors.conflict(
        'CASH_DECLARED',
        'Un encaissement a déjà été déclaré pour cette affectation',
      );
    }
  }

  private async findAssignment(tx: Db, traiteurId: string, assignmentId: string) {
    const row = await tx.staffAssignment.findFirst({ where: { id: assignmentId, traiteurId } });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Affectation introuvable');
    return row;
  }

  /** Verrouille la commande (affectations sérialisées) ; retourne le fuseau du traiteur. */
  private async lockOrder(tx: Db, traiteurId: string, orderId: string): Promise<string> {
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text AS "status" FROM "Order"
      WHERE "id" = ${orderId}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    const status = locked[0]?.status;
    if (!status) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    if (!STAFFABLE.includes(status)) {
      throw appErrors.badRequest(
        'ORDER_NOT_FIRM',
        'Le personnel s’affecte à une commande confirmée (ou en préparation)',
      );
    }
    return this.timeZone(tx, traiteurId);
  }

  private async timeZone(db: Db, traiteurId: string): Promise<string> {
    const traiteur = await db.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true },
    });
    return traiteur.timezone;
  }
}
