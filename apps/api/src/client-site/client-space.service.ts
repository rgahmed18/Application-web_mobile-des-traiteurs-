import { Injectable } from '@nestjs/common';
import {
  type ClientAccount,
  type ClientAccountUpdateInput,
  type ClientAddress,
  type ClientAddressInput,
  type ClientDashboard,
  type ClientInvoice,
  type ClientOrder,
  type ClientOrderSummary,
  type ClientPayment,
  type ClientQuoteSummary,
  type Download,
  utcToZoned,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { toLocalized } from '../catalog/catalog-common';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Prisma } from '../generated/prisma/client';
import { InvoicesService } from '../invoices/invoices.service';
import { readLineLabel } from '../documents/line-label';
import { NO_PAYMENT, orderSchedule, paymentTotals } from '../payments/payment-state';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientAccountService, type ClientContext, requireClient } from './client-account.service';

type Db = Prisma.TransactionClient;

/** Demandes et commandes visibles du client : jamais les brouillons du traiteur. */
const VISIBLE = { not: 'DRAFT' } as const;
/** Commandes encore actives (accueil de l'espace). */
const ACTIVE_STATUSES = [
  'PENDING',
  'QUOTED',
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

const summarySelect = {
  id: true,
  reference: true,
  status: true,
  eventDate: true,
  eventEndDate: true,
  guestCount: true,
  city: true,
  totalTtc: true,
  source: true,
  createdAt: true,
  eventTypeRef: { select: { name: true } },
  quotes: { where: { status: 'SENT' }, select: { id: true } },
} satisfies Prisma.OrderSelect;
type SummaryRow = Prisma.OrderGetPayload<{ select: typeof summarySelect }>;

const quoteSelect = {
  id: true,
  orderId: true,
  reference: true,
  version: true,
  status: true,
  totalTtc: true,
  validUntil: true,
  createdAt: true,
  sentAt: true,
  order: { select: { reference: true } },
} satisfies Prisma.QuoteSelect;
type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;

/**
 * Espace du client sur le site du traiteur : uniquement SES demandes et commandes chez CE
 * traiteur (fiche de la session), sans aucune donnée interne (notes internes, notes de service,
 * personnel, noms des employés). Les PDF passent par les services existants après contrôle
 * d'appartenance.
 */
@Injectable()
export class ClientSpaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: ClientAccountService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async dashboard(user: AuthenticatedUser): Promise<ClientDashboard> {
    const context = requireClient(user);
    const timeZone = await this.timeZone(context.traiteurId);
    const [active, quotes] = await Promise.all([
      this.prisma.order.findMany({
        where: this.ownOrders(context, { status: { in: [...ACTIVE_STATUSES] } }),
        orderBy: { eventDate: 'asc' },
        select: summarySelect,
      }),
      this.prisma.quote.findMany({
        where: { traiteurId: context.traiteurId, status: 'SENT', order: this.ownOrders(context) },
        orderBy: { sentAt: 'desc' },
        select: quoteSelect,
      }),
    ]);
    const settings = await this.scheduleSettings(context.traiteurId);
    const totals = await paymentTotals(
      this.prisma,
      context.traiteurId,
      active.map((order) => order.id),
    );
    // Prochaine échéance non couverte d'une commande confirmée
    let nextPayment: ClientDashboard['nextPayment'] = null;
    for (const order of active) {
      if (
        !['CONFIRMED', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)
      ) {
        continue;
      }
      const full = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          status: true,
          totalTtc: true,
          depositAmount: true,
          confirmedAt: true,
          eventDate: true,
        },
      });
      const schedule = orderSchedule(full, settings, (totals.get(order.id) ?? NO_PAYMENT).net);
      const due = schedule.installments.find((item) => item.remaining > 0);
      if (due && (!nextPayment || (due.dueDate ?? '') < (nextPayment.dueDate ?? '9999'))) {
        nextPayment = {
          kind: due.kind,
          amount: due.amount,
          remaining: due.remaining,
          dueDate: due.dueDate,
          overdue: due.overdue,
          orderId: order.id,
          orderReference: order.reference,
        };
      }
    }
    return {
      activeOrders: active.map((row) => this.toSummary(row, timeZone)),
      quotesToAnswer: quotes.map((row) => this.toQuote(row, timeZone)),
      nextPayment,
    };
  }

  async orders(user: AuthenticatedUser): Promise<ClientOrderSummary[]> {
    const context = requireClient(user);
    const timeZone = await this.timeZone(context.traiteurId);
    const rows = await this.prisma.order.findMany({
      where: this.ownOrders(context),
      orderBy: { createdAt: 'desc' },
      select: summarySelect,
    });
    return rows.map((row) => this.toSummary(row, timeZone));
  }

  async order(user: AuthenticatedUser, id: string): Promise<ClientOrder> {
    const context = requireClient(user);
    const { traiteurId } = context;
    const timeZone = await this.timeZone(traiteurId);
    const row = await this.prisma.order.findFirst({
      where: { id, ...this.ownOrders(context) },
      select: {
        ...summarySelect,
        venueName: true,
        venueAddress: true,
        notes: true,
        depositAmount: true,
        confirmedAt: true,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { label: true, quantity: true, unitPriceTtc: true, totalTtc: true },
        },
        statusChanges: {
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, fromStatus: true, toStatus: true, actorUserId: true },
        },
      },
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Demande introuvable');
    const [quotes, invoices, payments, settings, totals] = await Promise.all([
      this.prisma.quote.findMany({
        where: { traiteurId, orderId: id, status: { not: 'DRAFT' } },
        orderBy: [{ createdAt: 'desc' }],
        select: quoteSelect,
      }),
      this.invoiceRows(context, { orderId: id }),
      this.paymentRows(context, { orderId: id }),
      this.scheduleSettings(traiteurId),
      paymentTotals(this.prisma, traiteurId, [id]),
    ]);
    const paidNet = (totals.get(id) ?? NO_PAYMENT).net;
    const schedule = orderSchedule(row, settings, paidNet);
    const end = row.eventEndDate ? utcToZoned(row.eventEndDate, timeZone) : null;
    const start = utcToZoned(row.eventDate, timeZone);
    return {
      ...this.toSummary(row, timeZone),
      endTime: end?.time ?? null,
      endsNextDay: end !== null && end.date !== start.date,
      venueName: row.venueName,
      venueAddress: row.venueAddress,
      notes: row.notes,
      lines: row.items.map((item) => ({
        label: readLineLabel(item.label),
        quantity: item.quantity,
        unitPriceTtc: item.unitPriceTtc,
        totalTtc: item.totalTtc,
      })),
      history: row.statusChanges.map((change) => ({
        at: change.createdAt.toISOString(),
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        byClient: change.actorUserId === context.userId,
      })),
      quotes: quotes.map((quote) => this.toQuote(quote, timeZone)),
      invoices,
      payments,
      paid: paidNet,
      remaining: schedule.remaining,
      installments: schedule.installments.map((item) => ({
        kind: item.kind,
        amount: item.amount,
        remaining: item.remaining,
        dueDate: item.dueDate,
        overdue: item.overdue,
      })),
      cancellable: row.status === 'PENDING',
    };
  }

  async quotes(user: AuthenticatedUser): Promise<ClientQuoteSummary[]> {
    const context = requireClient(user);
    const timeZone = await this.timeZone(context.traiteurId);
    const rows = await this.prisma.quote.findMany({
      where: {
        traiteurId: context.traiteurId,
        status: { notIn: ['DRAFT', 'SUPERSEDED'] },
        order: this.ownOrders(context),
      },
      orderBy: { createdAt: 'desc' },
      select: quoteSelect,
    });
    return rows.map((row) => this.toQuote(row, timeZone));
  }

  invoices(user: AuthenticatedUser): Promise<ClientInvoice[]> {
    return this.invoiceRows(requireClient(user));
  }

  payments(user: AuthenticatedUser): Promise<ClientPayment[]> {
    return this.paymentRows(requireClient(user));
  }

  async invoicePdf(user: AuthenticatedUser, invoiceId: string): Promise<Download> {
    const context = requireClient(user);
    const owned = await this.prisma.invoice.count({
      where: { id: invoiceId, traiteurId: context.traiteurId, order: this.ownOrders(context) },
    });
    if (!owned) throw appErrors.notFound('NOT_FOUND', 'Facture introuvable');
    return this.invoicesService.pdfDownload(user, invoiceId);
  }

  async receipt(user: AuthenticatedUser, paymentId: string): Promise<Download> {
    const context = requireClient(user);
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        traiteurId: context.traiteurId,
        receiptNumber: { not: null },
        order: this.ownOrders(context),
      },
      select: { orderId: true },
    });
    if (!payment) throw appErrors.notFound('NOT_FOUND', 'Reçu introuvable');
    return this.paymentsService.receipt(user, payment.orderId, paymentId);
  }

  // ─────────────────────────── Profil et adresses ───────────────────────────

  /** Coordonnées chez CE traiteur (fiche) ; le compte et les autres traiteurs ne changent pas. */
  async updateAccount(
    user: AuthenticatedUser,
    input: ClientAccountUpdateInput,
    client: ClientInfo,
  ): Promise<ClientAccount> {
    const { traiteurId, membershipId } = requireClient(user);
    const before = await this.prisma.membership.findFirstOrThrow({
      where: { id: membershipId, traiteurId, role: 'CLIENT' },
      select: { firstName: true, lastName: true, email: true, locale: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membershipId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          locale: input.locale,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'client.account_updated',
          entityType: 'Membership',
          entityId: membershipId,
          before,
          after: input,
          client,
        },
        tx,
      );
    });
    return this.account.get(user);
  }

  async addresses(user: AuthenticatedUser): Promise<ClientAddress[]> {
    const { traiteurId, membershipId } = requireClient(user);
    const rows = await this.prisma.clientAddress.findMany({
      where: { traiteurId, membershipId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      address: row.address,
      city: row.city,
      isDefault: row.isDefault,
    }));
  }

  async saveAddress(
    user: AuthenticatedUser,
    addressId: string | null,
    input: ClientAddressInput,
  ): Promise<ClientAddress[]> {
    const { traiteurId, membershipId } = requireClient(user);
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.clientAddress.updateMany({
          where: { traiteurId, membershipId },
          data: { isDefault: false },
        });
      }
      if (addressId) {
        const { count } = await tx.clientAddress.updateMany({
          where: { id: addressId, traiteurId, membershipId },
          data: input,
        });
        if (!count) throw appErrors.notFound('NOT_FOUND', 'Adresse introuvable');
      } else {
        const existing = await tx.clientAddress.count({ where: { traiteurId, membershipId } });
        if (existing >= 20) {
          throw appErrors.badRequest('VALIDATION_ERROR', '20 adresses au plus');
        }
        await tx.clientAddress.create({ data: { ...input, traiteurId, membershipId } });
      }
    });
    return this.addresses(user);
  }

  async removeAddress(user: AuthenticatedUser, addressId: string): Promise<ClientAddress[]> {
    const { traiteurId, membershipId } = requireClient(user);
    const { count } = await this.prisma.clientAddress.deleteMany({
      where: { id: addressId, traiteurId, membershipId },
    });
    if (!count) throw appErrors.notFound('NOT_FOUND', 'Adresse introuvable');
    return this.addresses(user);
  }

  // ─────────────────────────── Interne ───────────────────────────

  /** Commandes de CE client chez CE traiteur (hors brouillons du traiteur). */
  private ownOrders(
    { traiteurId, membershipId }: ClientContext,
    extra: Prisma.OrderWhereInput = {},
  ): Prisma.OrderWhereInput {
    return { traiteurId, clientId: membershipId, status: VISIBLE, ...extra };
  }

  private async invoiceRows(
    context: ClientContext,
    extra: Prisma.InvoiceWhereInput = {},
  ): Promise<ClientInvoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { traiteurId: context.traiteurId, order: this.ownOrders(context), ...extra },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        number: true,
        type: true,
        kind: true,
        totalTtc: true,
        issuedAt: true,
        order: { select: { reference: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderReference: row.order.reference,
      number: row.number,
      type: row.type,
      kind: row.kind,
      totalTtc: row.totalTtc,
      issuedAt: row.issuedAt.toISOString(),
    }));
  }

  /** Encaissements validés (réussis), annulés compris pour l'historique ; jamais en attente. */
  private async paymentRows(
    context: ClientContext,
    extra: Prisma.PaymentWhereInput = {},
  ): Promise<ClientPayment[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        traiteurId: context.traiteurId,
        order: this.ownOrders(context),
        OR: [{ status: 'SUCCEEDED' }, { voidedAt: { not: null } }],
        ...extra,
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        orderId: true,
        type: true,
        method: true,
        amount: true,
        paidAt: true,
        receiptNumber: true,
        voidedAt: true,
        order: { select: { reference: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderReference: row.order.reference,
      type: row.type,
      method: row.method,
      amount: row.amount,
      paidAt: row.paidAt?.toISOString() ?? null,
      receiptNumber: row.receiptNumber,
      voided: row.voidedAt !== null,
    }));
  }

  private toSummary(row: SummaryRow, timeZone: string): ClientOrderSummary {
    const start = utcToZoned(row.eventDate, timeZone);
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      eventTypeName: toLocalized(row.eventTypeRef.name),
      eventDate: start.date,
      startTime: start.time,
      guestCount: row.guestCount,
      city: row.city,
      totalTtc: row.totalTtc,
      source: row.source,
      quoteToAnswer: row.quotes.length > 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toQuote(row: QuoteRow, timeZone: string): ClientQuoteSummary {
    return {
      id: row.id,
      orderId: row.orderId,
      orderReference: row.order.reference,
      reference: row.reference,
      version: row.version,
      status: row.status === 'DRAFT' ? 'SENT' : row.status,
      totalTtc: row.totalTtc,
      validUntil: row.validUntil ? utcToZoned(row.validUntil, timeZone).date : null,
      sentAt: row.sentAt?.toISOString() ?? null,
    };
  }

  private async timeZone(traiteurId: string): Promise<string> {
    const { timezone } = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true },
    });
    return timezone;
  }

  private scheduleSettings(traiteurId: string, db: Db | PrismaService = this.prisma) {
    return db.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true, depositPercentBps: true, balanceDueDays: true },
    });
  }
}
