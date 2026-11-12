import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  type ClientAvailability,
  type ClientAvailabilityQuery,
  type ClientRequestCreated,
  type ClientRequestInput,
  type ClientRequestItem,
  type LineItemType,
  type LocalizedText,
  resolveTaxRate,
  todayInTimeZone,
  zonedToUtc,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { toLocalized } from '../catalog/catalog-common';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Env } from '../config/env.schema';
import type { LineDraft } from '../documents/document-lines';
import { DocumentLinesService } from '../documents/document-lines.service';
import type { Prisma } from '../generated/prisma/client';
import { dayAvailability, hasConflict, lockDay } from '../orders/availability';
import { equipmentShortages } from '../orders/equipment-stock';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { nextDocumentNumber } from '../sequences/document-sequence';
import { type ClientContext, requireClient } from './client-account.service';

type Db = Prisma.TransactionClient;

/** Élément publié : actif et non archivé. */
const published = { isActive: true, archivedAt: null } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const settingsSelect = {
  timezone: true,
  maxEventsPerDay: true,
  closedWeekdays: true,
  priceEntryMode: true,
  isVatRegistered: true,
  defaultTaxRateBps: true,
  equipmentSetupHours: true,
  equipmentReturnHours: true,
} satisfies Prisma.TraiteurSelect;
type RequestSettings = Prisma.TraiteurGetPayload<{ select: typeof settingsSelect }>;

/** Début et fin de l'événement (instants), depuis le jour et les heures du fuseau du traiteur. */
function instants(
  input: Pick<ClientRequestInput, 'eventDate' | 'startTime' | 'endTime' | 'endsNextDay'>,
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
  return { eventDate, eventEndDate };
}

/**
 * Demandes envoyées par les clients depuis le site : disponibilité indicative (jamais de
 * chiffres), création d'une commande « En attente » dont les lignes et les prix viennent du
 * catalogue publié, annulation tant qu'elle est en attente. Toujours la fiche de la session.
 */
@Injectable()
export class ClientRequestsService {
  private readonly perDay: number;
  private readonly pendingMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lines: DocumentLinesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.perDay = config.get('CLIENT_REQUESTS_PER_DAY', { infer: true });
    this.pendingMax = config.get('CLIENT_PENDING_REQUESTS_MAX', { infer: true });
  }

  /**
   * Disponibilité indicative : la date (fermeture, date bloquée, capacité) et chaque matériel
   * (stock sur la période) sont « disponibles » ou « sur demande » ; jamais de chiffre.
   */
  async availability(
    user: AuthenticatedUser,
    query: ClientAvailabilityQuery,
  ): Promise<ClientAvailability> {
    const { traiteurId } = requireClient(user);
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const day = await dayAvailability(tx, traiteurId, query.eventDate, settings);
      const tooSoon = query.eventDate <= todayInTimeZone(settings.timezone);
      const { eventDate, eventEndDate } = instants(query, settings.timezone);
      const shortages = await equipmentShortages(
        tx,
        traiteurId,
        {
          id: null,
          eventDate,
          eventEndDate,
          equipmentSetupHours: null,
          equipmentReturnHours: null,
        },
        query.equipment.map((item) => ({ equipmentId: item.id, quantity: item.quantity })),
        settings,
      );
      const short = new Set(shortages.map((shortage) => shortage.equipmentId));
      return {
        date: tooSoon || hasConflict(day) ? 'ON_REQUEST' : 'AVAILABLE',
        equipment: query.equipment.map((item) => ({
          id: item.id,
          status: short.has(item.id) ? 'ON_REQUEST' : 'AVAILABLE',
        })),
      };
    });
  }

  async create(
    user: AuthenticatedUser,
    input: ClientRequestInput,
    client: ClientInfo,
  ): Promise<ClientRequestCreated> {
    const context = requireClient(user);
    const { traiteurId, membershipId } = context;
    const created = await this.prisma.$transaction(async (tx) => {
      // Une demande à la fois par client : les limites se comptent sans course
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-request:${membershipId}`}))`;
      const member = await tx.membership.findFirst({
        where: { id: membershipId, traiteurId, role: 'CLIENT', status: 'ACTIVE' },
        select: { clientApproval: true, firstName: true, lastName: true },
      });
      if (!member) throw appErrors.forbidden('FORBIDDEN_ROLE', 'Espace réservé aux clients');
      if (member.clientApproval !== 'APPROVED') {
        throw appErrors.forbidden(
          'CLIENT_NOT_APPROVED',
          'Votre compte attend la validation du traiteur',
        );
      }
      await this.assertLimits(tx, context);

      const settings = await this.settings(tx, traiteurId);
      if (input.eventDate <= todayInTimeZone(settings.timezone)) {
        throw appErrors.badRequest('DATE_TOO_SOON', 'Choisissez une date à partir de demain');
      }
      const eventType = await tx.eventType.findFirst({
        where: { traiteurId, code: input.eventType, ...published },
        select: { code: true },
      });
      if (!eventType) throw appErrors.badRequest('VALIDATION_ERROR', 'Type d’événement inconnu');
      const drafts = await this.lineDrafts(tx, traiteurId, settings, input);
      const { eventDate, eventEndDate } = instants(input, settings.timezone);
      if (eventEndDate && eventEndDate <= eventDate) {
        throw appErrors.badRequest('VALIDATION_ERROR', 'La fin doit être après le début');
      }
      // Même verrou que les commandes du back-office : la capacité du jour reste juste
      await lockDay(tx, traiteurId, input.eventDate);

      const number = await nextDocumentNumber(tx, {
        traiteurId,
        type: 'ORDER',
        timeZone: settings.timezone,
      });
      const order = await tx.order.create({
        data: {
          traiteurId,
          reference: number.reference,
          clientId: membershipId,
          eventType: eventType.code,
          eventDate,
          eventEndDate,
          guestCount: input.guestCount,
          venueName: input.venueName,
          venueAddress: input.venueAddress,
          city: input.city,
          status: 'PENDING',
          source: 'ONLINE',
          priceMode: settings.priceEntryMode,
          notes: input.notes,
          onSiteContactName: input.onSiteContactName,
          onSiteContactPhone: input.onSiteContactPhone,
        },
      });
      await this.lines.addLines({ kind: 'ORDER', id: order.id, traiteurId }, drafts, tx);
      const actorName = `${member.firstName} ${member.lastName}`.trim();
      await tx.orderStatusChange.create({
        data: {
          traiteurId,
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PENDING',
          actorUserId: context.userId,
          actorName,
        },
      });
      if (input.saveAddressAs) {
        await tx.clientAddress.create({
          data: {
            traiteurId,
            membershipId,
            label: input.saveAddressAs,
            address: input.venueAddress,
            city: input.city,
          },
        });
      }
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.requested_online',
          entityType: 'Order',
          entityId: order.id,
          after: {
            reference: order.reference,
            eventDate: eventDate.toISOString(),
            guestCount: order.guestCount,
            lines: drafts.length,
          },
          client,
        },
        tx,
      );
      const notificationId = await this.notifications.record(tx, {
        traiteurId,
        type: 'ORDER_REQUESTED',
        entityType: 'Order',
        entityId: order.id,
        data: { clientName: actorName, reference: order.reference },
      });
      return { id: order.id, reference: order.reference, notificationId };
    });
    await this.notifications.dispatch([created.notificationId]);
    return { id: created.id, reference: created.reference };
  }

  /** Annulation par le client, tant que la demande est « En attente » (avant tout devis). */
  async cancel(user: AuthenticatedUser, orderId: string, client: ClientInfo): Promise<void> {
    const { traiteurId, membershipId, userId } = requireClient(user);
    const notificationId = await this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { firstName: true, lastName: true },
      });
      const now = new Date();
      const { count } = await tx.order.updateMany({
        where: { id: orderId, traiteurId, clientId: membershipId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: 'Annulée par le client',
        },
      });
      if (count === 0) {
        const exists = await tx.order.count({
          where: { id: orderId, traiteurId, clientId: membershipId },
        });
        if (!exists) throw appErrors.notFound('NOT_FOUND', 'Demande introuvable');
        throw appErrors.conflict(
          'ORDER_NOT_CANCELLABLE',
          'Cette demande est déjà traitée : contactez le traiteur pour l’annuler',
        );
      }
      await tx.orderStatusChange.create({
        data: {
          traiteurId,
          orderId,
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          reason: 'Annulée par le client',
          actorUserId: userId,
          actorName: `${member.firstName} ${member.lastName}`.trim(),
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.cancelled_by_client',
          entityType: 'Order',
          entityId: orderId,
          after: { status: 'CANCELLED' },
          client,
        },
        tx,
      );
      const { reference } = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { reference: true },
      });
      return this.notifications.record(tx, {
        traiteurId,
        type: 'ORDER_REQUEST_CANCELLED',
        entityType: 'Order',
        entityId: orderId,
        data: { clientName: `${member.firstName} ${member.lastName}`.trim(), reference },
      });
    });
    await this.notifications.dispatch([notificationId]);
  }

  // ─────────────────────────── Interne ───────────────────────────

  private settings(db: Db, traiteurId: string): Promise<RequestSettings> {
    return db.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: settingsSelect });
  }

  /** Limites anti-abus : demandes sur 24 h et demandes encore en attente, par client. */
  private async assertLimits(tx: Db, { traiteurId, membershipId }: ClientContext): Promise<void> {
    const [recent, pending] = await Promise.all([
      tx.order.count({
        where: {
          traiteurId,
          clientId: membershipId,
          source: 'ONLINE',
          createdAt: { gt: new Date(Date.now() - DAY_MS) },
        },
      }),
      tx.order.count({
        where: { traiteurId, clientId: membershipId, source: 'ONLINE', status: 'PENDING' },
      }),
    ]);
    if (recent >= this.perDay) {
      throw appErrors.tooManyRequests(
        'REQUEST_LIMIT',
        'Vous avez envoyé beaucoup de demandes aujourd’hui : réessayez demain',
        { retryAfterSeconds: 24 * 3600 },
      );
    }
    if (pending >= this.pendingMax) {
      throw appErrors.tooManyRequests(
        'REQUEST_LIMIT',
        'Plusieurs demandes attendent déjà la réponse du traiteur',
        { retryAfterSeconds: 3600 },
      );
    }
  }

  /**
   * Lignes de la commande depuis le catalogue PUBLIÉ : prix dans le mode du traiteur, TVA de
   * l'élément, quantité par invité pour les menus, buffets et services comptés par personne.
   */
  private async lineDrafts(
    tx: Db,
    traiteurId: string,
    settings: RequestSettings,
    input: ClientRequestInput,
  ): Promise<LineDraft[]> {
    const merged = new Map<string, ClientRequestItem>();
    for (const item of input.items) {
      const key = `${item.kind}:${item.id}`;
      const existing = merged.get(key);
      merged.set(key, existing ? { ...item, quantity: existing.quantity + item.quantity } : item);
    }
    const items = [...merged.values()];
    const ids = (kind: ClientRequestItem['kind']) =>
      items.filter((item) => item.kind === kind).map((item) => item.id);
    const where = (kind: ClientRequestItem['kind']) => ({
      traiteurId,
      id: { in: ids(kind) },
      ...published,
    });
    const [menus, buffets, equipment, services] = await Promise.all([
      tx.package.findMany({ where: where('menu') }),
      tx.buffet.findMany({ where: where('buffet') }),
      tx.equipmentItem.findMany({ where: where('equipment') }),
      tx.extraService.findMany({ where: where('service') }),
    ]);
    const price = (ht: number, ttc: number) => (settings.priceEntryMode === 'TTC' ? ttc : ht);
    const tax = (rate: number | null) => resolveTaxRate(settings, rate);
    const guests = input.guestCount;

    return items.map((item, index): LineDraft => {
      const line = (
        itemType: LineItemType,
        name: unknown,
        values: Omit<LineDraft, 'itemType' | 'label' | 'sortOrder'>,
      ): LineDraft => {
        const label: LocalizedText = toLocalized(name as Prisma.JsonValue);
        return { itemType, label, sortOrder: index, ...values };
      };
      if (item.kind === 'menu') {
        const row = menus.find((menu) => menu.id === item.id);
        if (!row) throw this.unavailable();
        if (guests < row.minGuests || (row.maxGuests !== null && guests > row.maxGuests)) {
          throw appErrors.badRequest(
            'GUESTS_OUT_OF_RANGE',
            'Nombre d’invités hors des limites du menu',
            {
              minGuests: row.minGuests,
              maxGuests: row.maxGuests,
            },
          );
        }
        return line('PACKAGE', row.name, {
          packageId: row.id,
          quantity: guests,
          perPerson: true,
          unitPrice: price(row.pricePerPersonHt, row.pricePerPersonTtc),
          taxRateBps: tax(row.taxRateBps),
        });
      }
      if (item.kind === 'buffet') {
        const row = buffets.find((buffet) => buffet.id === item.id);
        if (!row) throw this.unavailable();
        const perPerson = row.pricingUnit === 'PER_PERSON';
        if (perPerson && guests < row.minGuests) {
          throw appErrors.badRequest(
            'GUESTS_OUT_OF_RANGE',
            'Nombre d’invités sous le minimum du buffet',
            {
              minGuests: row.minGuests,
              maxGuests: null,
            },
          );
        }
        return line('BUFFET', row.name, {
          buffetId: row.id,
          quantity: perPerson ? guests : 1,
          perPerson,
          unitPrice: price(row.priceHt, row.priceTtc),
          taxRateBps: tax(row.taxRateBps),
        });
      }
      if (item.kind === 'equipment') {
        const row = equipment.find((candidate) => candidate.id === item.id);
        if (!row) throw this.unavailable();
        return line('EQUIPMENT', row.name, {
          equipmentId: row.id,
          quantity: item.quantity,
          perPerson: false,
          unitPrice: price(row.priceHt, row.priceTtc),
          taxRateBps: tax(row.taxRateBps),
        });
      }
      const row = services.find((service) => service.id === item.id);
      if (!row) throw this.unavailable();
      const perPerson = row.pricingUnit === 'PER_PERSON';
      return line('EXTRA_SERVICE', row.name, {
        extraServiceId: row.id,
        quantity: perPerson ? guests : item.quantity,
        perPerson,
        unitPrice: price(row.priceHt, row.priceTtc),
        taxRateBps: tax(row.taxRateBps),
      });
    });
  }

  private unavailable() {
    return appErrors.badRequest(
      'ITEM_UNAVAILABLE',
      'Un élément de votre demande n’est plus proposé : retirez-le puis renvoyez la demande',
    );
  }
}
