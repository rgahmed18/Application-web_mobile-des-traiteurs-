import { Injectable } from '@nestjs/common';
import {
  DELIVERY_STEPS,
  type Download,
  findTransition,
  type Mission,
  type MissionCollectInput,
  type MissionDeclineInput,
  type MissionDeliveryInput,
  type MissionListQuery,
  type MissionSummary,
  todayInTimeZone,
  utcToZoned,
  zonedDayRange,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { AuditService } from '../audit/audit.service';
import { toLocalized } from '../catalog/catalog-common';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import { readLineLabel } from '../documents/line-label';
import type { Prisma } from '../generated/prisma/client';
import { toSchedule } from '../orders/order-mapper';
import { OrdersService } from '../orders/orders.service';
import { CashDeskService, type PhotoFile } from '../payments/cash-desk.service';
import type { DocLocale } from '../pdf/format';
import { PrismaService } from '../prisma/prisma.service';
import { CASH_ROLES, latestDeclaration, toDeclaration } from './cash-declaration';
import { ServiceDocumentsService } from './service-documents.service';

/**
 * Missions d'un membre de l'équipe ou d'un livreur : uniquement les siennes, avec ce qui sert à
 * l'exécution (date, horaires, lieu, contact sur place, contenu, matériel, notes de service).
 * Jamais de prix, de total, de paiement ni de note interne : la réponse est construite champ par
 * champ, sans recopier la commande. Une mission terminée depuis le délai réglé
 * (Traiteur.missionRedactionDays) ne garde que la date, la référence et la ville.
 */
const missionInclude = {
  order: {
    select: {
      id: true,
      reference: true,
      status: true,
      version: true,
      eventType: true,
      eventTypeRef: { select: { name: true } },
      eventDate: true,
      eventEndDate: true,
      guestCount: true,
      venueName: true,
      venueAddress: true,
      city: true,
      latitude: true,
      longitude: true,
      notes: true,
      serviceNotes: true,
      equipment: true,
      onSiteContactName: true,
      onSiteContactPhone: true,
      client: { select: { firstName: true, lastName: true, user: { select: { phone: true } } } },
      items: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { itemType: true, label: true, quantity: true },
      },
      staffAssignments: {
        where: { status: { not: 'DECLINED' } },
        orderBy: { startAt: 'asc' },
        select: {
          membershipId: true,
          staffRole: true,
          membership: {
            select: { firstName: true, lastName: true, user: { select: { phone: true } } },
          },
        },
      },
    },
  },
  payments: latestDeclaration,
} satisfies Prisma.StaffAssignmentInclude;
type MissionRow = Prisma.StaffAssignmentGetPayload<{ include: typeof missionInclude }>;

const KITCHEN_ROLES = ['CHEF', 'COOK', 'SUPERVISOR'];
const DELIVERY_ROLES = ['DRIVER', 'SUPERVISOR'];
const PAST_LIMIT = 50;
/** Commandes où le livreur peut déclarer un encaissement (pas annulée, ni en devis). */
const COLLECTABLE = ['CONFIRMED', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];
/** Une déclaration est possible à partir de 12 h avant le début de la mission. */
const COLLECT_WINDOW_MS = 12 * 3_600_000;

@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    private readonly orders: OrdersService,
    private readonly documents: ServiceDocumentsService,
    private readonly cashDesk: CashDeskService,
  ) {}

  async list(user: AuthenticatedUser, query: MissionListQuery): Promise<MissionSummary[]> {
    const traiteurId = requireTraiteurId(user);
    const settings = await this.settings(traiteurId);
    const startOfToday = zonedDayRange(todayInTimeZone(settings.timezone), settings.timezone).start;
    const rows = await this.prisma.staffAssignment.findMany({
      where: {
        traiteurId,
        membershipId: this.memberId(user),
        ...(query.scope === 'upcoming'
          ? { endAt: { gte: startOfToday } }
          : { endAt: { lt: startOfToday } }),
      },
      include: missionInclude,
      orderBy: { startAt: query.scope === 'upcoming' ? 'asc' : 'desc' },
      take: query.scope === 'upcoming' ? undefined : PAST_LIMIT,
    });
    return rows.map((row) => this.summary(row, settings));
  }

  async get(user: AuthenticatedUser, missionId: string): Promise<Mission> {
    const traiteurId = requireTraiteurId(user);
    const [row, settings, permissions] = await Promise.all([
      this.find(traiteurId, user, missionId),
      this.settings(traiteurId),
      this.permissions.getEffectivePermissions(traiteurId, user.role),
    ]);
    return this.detail(row, settings, permissions, user);
  }

  async confirm(user: AuthenticatedUser, missionId: string, client: ClientInfo): Promise<Mission> {
    return this.respond(user, missionId, client, 'confirm', null);
  }

  async decline(
    user: AuthenticatedUser,
    missionId: string,
    input: MissionDeclineInput,
    client: ClientInfo,
  ): Promise<Mission> {
    return this.respond(user, missionId, client, 'decline', input.reason);
  }

  async finish(user: AuthenticatedUser, missionId: string, client: ClientInfo): Promise<Mission> {
    return this.respond(user, missionId, client, 'finish', null);
  }

  /** Livreur affecté comme chauffeur : « Parti en livraison », puis « Livré ». */
  async deliveryStep(
    user: AuthenticatedUser,
    missionId: string,
    input: MissionDeliveryInput,
    client: ClientInfo,
  ): Promise<Mission> {
    const traiteurId = requireTraiteurId(user);
    const [row, settings, permissions] = await Promise.all([
      this.find(traiteurId, user, missionId),
      this.settings(traiteurId),
      this.permissions.getEffectivePermissions(traiteurId, user.role),
    ]);
    const steps = this.deliverySteps(row, permissions, settings);
    if (!steps.includes(input.to)) {
      throw appErrors.badRequest('MISSION_NOT_ALLOWED', 'Étape de livraison impossible maintenant');
    }
    await this.orders.transition(
      user,
      row.orderId,
      {
        to: input.to,
        version: row.order.version,
        reason: null,
        forceAvailability: false,
        refund: null,
      },
      client,
    );
    return this.get(user, missionId);
  }

  /** « Encaissé » : paiement en attente de remise, validé plus tard par l'administrateur. */
  async collect(
    user: AuthenticatedUser,
    missionId: string,
    input: MissionCollectInput,
    photo: PhotoFile | undefined,
    client: ClientInfo,
  ): Promise<Mission> {
    const traiteurId = requireTraiteurId(user);
    const [row, settings, permissions] = await Promise.all([
      this.find(traiteurId, user, missionId),
      this.settings(traiteurId),
      this.permissions.getEffectivePermissions(traiteurId, user.role),
    ]);
    if (!this.cashCollection(row, settings, permissions)?.canDeclare) {
      throw appErrors.badRequest('MISSION_NOT_ALLOWED', 'Aucun encaissement à déclarer maintenant');
    }
    await this.cashDesk.declare(user, { id: row.id, orderId: row.orderId }, input, photo, client);
    return this.get(user, missionId);
  }

  async deliveryNote(user: AuthenticatedUser, missionId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const [row, settings] = await Promise.all([
      this.find(traiteurId, user, missionId),
      this.settings(traiteurId),
    ]);
    if (!this.documentsFor(row, settings).deliveryNote) {
      throw appErrors.forbidden('MISSION_NOT_ALLOWED', 'Bon de livraison non disponible');
    }
    return this.documents.deliveryNote(traiteurId, row.orderId, row.startAt);
  }

  async preparationSheet(
    user: AuthenticatedUser,
    missionId: string,
    locale: DocLocale,
  ): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const [row, settings] = await Promise.all([
      this.find(traiteurId, user, missionId),
      this.settings(traiteurId),
    ]);
    if (!this.documentsFor(row, settings).preparationSheet) {
      throw appErrors.forbidden('MISSION_NOT_ALLOWED', 'Bon de préparation non disponible');
    }
    return this.documents.orderPreparation(traiteurId, row.orderId, locale);
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async respond(
    user: AuthenticatedUser,
    missionId: string,
    client: ClientInfo,
    action: 'confirm' | 'decline' | 'finish',
    reason: string | null,
  ): Promise<Mission> {
    const traiteurId = requireTraiteurId(user);
    const settings = await this.settings(traiteurId);
    const row = await this.find(traiteurId, user, missionId);
    const flags = this.flags(row, settings);
    const allowed =
      action === 'confirm'
        ? flags.canConfirm
        : action === 'decline'
          ? flags.canDecline
          : flags.canFinish;
    if (!allowed) {
      throw appErrors.badRequest('MISSION_NOT_ALLOWED', 'Action impossible pour cette mission');
    }
    const now = new Date();
    const data: Prisma.StaffAssignmentUpdateManyMutationInput =
      action === 'confirm'
        ? { status: 'CONFIRMED', respondedAt: now }
        : action === 'decline'
          ? { status: 'DECLINED', respondedAt: now, declineReason: reason }
          : { status: 'DONE', respondedAt: row.respondedAt ?? now, doneAt: now };
    // Statut vérifié dans la requête : deux réponses simultanées ne s'écrasent pas
    const { count } = await this.prisma.staffAssignment.updateMany({
      where: { id: missionId, traiteurId, status: row.status },
      data,
    });
    if (count === 0) {
      throw appErrors.conflict('MISSION_NOT_ALLOWED', 'La mission a changé entre-temps');
    }
    await this.audit.record({
      traiteurId,
      actor: user,
      action: `assignment.${action === 'confirm' ? 'confirmed' : action === 'decline' ? 'declined' : 'done'}`,
      entityType: 'StaffAssignment',
      entityId: missionId,
      before: { status: row.status },
      after: { status: data.status ?? null, reason },
      client,
    });
    return this.get(user, missionId);
  }

  private memberId(user: AuthenticatedUser): string {
    if (!user.membershipId) throw appErrors.forbidden('TRAITEUR_REQUIRED', 'Aucun membre actif');
    return user.membershipId;
  }

  /** Mission du membre connecté : celle d'un autre n'existe pas pour lui (404). */
  private async find(traiteurId: string, user: AuthenticatedUser, missionId: string) {
    const row = await this.prisma.staffAssignment.findFirst({
      where: { id: missionId, traiteurId, membershipId: this.memberId(user) },
      include: missionInclude,
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Mission introuvable');
    return row;
  }

  private settings(traiteurId: string) {
    return this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true, missionRedactionDays: true },
    });
  }

  private redacted(row: MissionRow, settings: { missionRedactionDays: number | null }): boolean {
    if (settings.missionRedactionDays === null) return false;
    const end = row.order.eventEndDate ?? row.endAt;
    const latest = end > row.endAt ? end : row.endAt;
    return latest.getTime() + settings.missionRedactionDays * 86_400_000 < Date.now();
  }

  private summary(
    row: MissionRow,
    settings: { timezone: string; missionRedactionDays: number | null },
  ): MissionSummary {
    const tz = settings.timezone;
    const redacted = this.redacted(row, settings);
    const start = utcToZoned(row.startAt, tz);
    const end = utcToZoned(row.endAt, tz);
    return {
      id: row.id,
      orderReference: row.order.reference,
      orderStatus: row.order.status,
      eventType: row.order.eventType,
      eventTypeName: toLocalized(row.order.eventTypeRef.name),
      staffRole: row.staffRole,
      status: row.status,
      start: { date: start.date, time: start.time },
      end: { date: end.date, time: end.time },
      eventDate: utcToZoned(row.order.eventDate, tz).date,
      guestCount: row.order.guestCount,
      place: redacted ? row.order.city : (row.order.venueName ?? row.order.city),
      city: row.order.city,
      redacted,
    };
  }

  private flags(row: MissionRow, settings: { missionRedactionDays: number | null }) {
    const now = Date.now();
    const cancelled = row.order.status === 'CANCELLED';
    const redacted = this.redacted(row, settings);
    const before = row.endAt.getTime() > now;
    return {
      canConfirm: !cancelled && !redacted && before && row.status === 'ASSIGNED',
      canDecline: !cancelled && before && (row.status === 'ASSIGNED' || row.status === 'CONFIRMED'),
      canFinish:
        !cancelled && !redacted && row.status === 'CONFIRMED' && row.startAt.getTime() <= now,
    };
  }

  private deliverySteps(
    row: MissionRow,
    permissions: ReadonlySet<string>,
    settings: { missionRedactionDays: number | null },
  ): ('OUT_FOR_DELIVERY' | 'DELIVERED')[] {
    if (!permissions.has('deliveries.update_status')) return [];
    if (!DELIVERY_ROLES.includes(row.staffRole) || this.redacted(row, settings)) return [];
    if (row.status === 'DECLINED') return [];
    return DELIVERY_STEPS.filter((to) => findTransition(row.order.status, to) !== null);
  }

  /** Montant à encaisser : seulement sur la mission où l'administrateur l'a réglé. */
  private cashCollection(
    row: MissionRow,
    settings: { missionRedactionDays: number | null },
    permissions: ReadonlySet<string>,
  ): Mission['cashCollection'] {
    if (row.cashToCollect === null || !CASH_ROLES.includes(row.staffRole)) return null;
    if (row.cashMethod !== 'CASH' && row.cashMethod !== 'CHEQUE') return null;
    if (this.redacted(row, settings)) return null;
    const declaration = toDeclaration(row.payments[0]);
    const live = declaration !== null && declaration.status !== 'REJECTED';
    return {
      amount: row.cashToCollect,
      method: row.cashMethod,
      declaration,
      canDeclare:
        permissions.has('deliveries.collect_cash') &&
        !live &&
        row.status !== 'DECLINED' &&
        COLLECTABLE.includes(row.order.status) &&
        row.startAt.getTime() - COLLECT_WINDOW_MS <= Date.now(),
    };
  }

  private documentsFor(row: MissionRow, settings: { missionRedactionDays: number | null }) {
    const usable =
      row.status !== 'DECLINED' &&
      row.order.status !== 'CANCELLED' &&
      !this.redacted(row, settings);
    return {
      deliveryNote: usable && DELIVERY_ROLES.includes(row.staffRole),
      preparationSheet: usable && KITCHEN_ROLES.includes(row.staffRole),
    };
  }

  private detail(
    row: MissionRow,
    settings: { timezone: string; missionRedactionDays: number | null },
    permissions: ReadonlySet<string>,
    user: AuthenticatedUser,
  ): Mission {
    const summary = this.summary(row, settings);
    const { order } = row;
    const redacted = summary.redacted;
    const schedule = toSchedule(order, settings.timezone);
    const clientName = `${order.client.firstName} ${order.client.lastName}`.trim();
    const address = [order.venueName, order.venueAddress, order.city].filter(Boolean).join(', ');
    const query =
      order.latitude !== null && order.longitude !== null
        ? `${order.latitude.toString()},${order.longitude.toString()}`
        : address;
    return {
      ...summary,
      event: {
        date: schedule.eventDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        endsNextDay: schedule.endsNextDay,
      },
      venue: redacted
        ? null
        : {
            name: order.venueName,
            address: order.venueAddress,
            city: order.city,
            mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
            directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`,
          },
      contact: redacted
        ? null
        : {
            name: order.onSiteContactName ?? clientName,
            phone: order.onSiteContactPhone ?? order.client.user.phone,
          },
      content: order.items.map((item) => ({
        label: readLineLabel(item.label),
        quantity: item.quantity,
        itemType: item.itemType,
      })),
      equipment: redacted ? null : order.equipment,
      serviceNotes: redacted ? null : order.serviceNotes,
      missionNotes: redacted ? null : row.notes,
      clientNotes: redacted ? null : order.notes,
      team: order.staffAssignments.map((member) => ({
        firstName: member.membership.firstName,
        lastName: member.membership.lastName,
        staffRole: member.staffRole,
        phone: redacted ? null : member.membership.user.phone,
        isSelf: member.membershipId === user.membershipId,
      })),
      declineReason: row.declineReason,
      deliverySteps: this.deliverySteps(row, permissions, settings),
      ...this.flags(row, settings),
      documents: this.documentsFor(row, settings),
      cashCollection: this.cashCollection(row, settings, permissions),
    };
  }
}
