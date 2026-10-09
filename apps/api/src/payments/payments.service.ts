import { Injectable, Logger } from '@nestjs/common';
import {
  type DepositUpdateInput,
  type Download,
  type OrderPayments,
  type Payment,
  type PaymentInput,
  type PaymentType,
  type RefundInput,
  todayInTimeZone,
  utcToZoned,
  type VoidPaymentInput,
  zonedToUtc,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { DOCUMENT_TEMPLATE_VERSION, PdfService } from '../pdf/pdf.service';
import { type Seller, sellerSelect } from '../pdf/seller';
import { PrismaService } from '../prisma/prisma.service';
import { nextDocumentNumber } from '../sequences/document-sequence';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';
import { COUNTED_PAYMENT, orderSchedule, paymentTotals } from './payment-state';
import { receiptDocument } from './receipt-document';

type Db = Prisma.TransactionClient;

const paymentInclude = {
  recordedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const orderSelect = {
  id: true,
  traiteurId: true,
  reference: true,
  status: true,
  totalTtc: true,
  depositAmount: true,
  cancellationFeeAmount: true,
  confirmedAt: true,
  eventDate: true,
  client: {
    select: { firstName: true, lastName: true, locale: true, user: { select: { phone: true } } },
  },
} satisfies Prisma.OrderSelect;
type OrderForPayment = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/** Statuts où un encaissement est accepté (pas sur une commande annulée). */
const PAYABLE = [
  'DRAFT',
  'PENDING',
  'QUOTED',
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

const settingsSelect = {
  timezone: true,
  depositPercentBps: true,
  balanceDueDays: true,
} satisfies Prisma.TraiteurSelect;

/**
 * Encaissements manuels d'une commande (espèces, virement, chèque, carte sur TPE), remboursements,
 * reçus numérotés (REC-…) et échéancier. Un encaissement ne se modifie ni ne se supprime : une
 * erreur se corrige en l'annulant (motif obligatoire). Garanties de la base : payé net compris
 * entre 0 et le total TTC, encaissements immuables.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
  ) {}

  async forOrder(user: AuthenticatedUser, orderId: string): Promise<OrderPayments> {
    const traiteurId = requireTraiteurId(user);
    return this.state(this.prisma, traiteurId, orderId);
  }

  async record(
    user: AuthenticatedUser,
    orderId: string,
    input: PaymentInput,
    client: ClientInfo,
  ): Promise<OrderPayments> {
    const traiteurId = requireTraiteurId(user);
    const paymentId = await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const order = await this.lockOrder(tx, traiteurId, orderId);
      if (!PAYABLE.includes(order.status)) {
        throw appErrors.badRequest(
          'PAYMENT_NOT_ALLOWED',
          'Commande annulée : aucun encaissement possible',
        );
      }
      this.assertDate(input.paidOn, settings.timezone);
      const paid = (await paymentTotals(tx, traiteurId, [orderId])).get(orderId)?.net ?? 0;
      if (paid + input.amount > order.totalTtc) {
        throw appErrors.badRequest(
          'PAYMENT_EXCEEDS_TOTAL',
          'Le total payé dépasserait le total TTC',
          {
            remaining: order.totalTtc - paid,
          },
        );
      }

      const number = await nextDocumentNumber(tx, {
        traiteurId,
        type: 'RECEIPT',
        timeZone: settings.timezone,
      });
      const payment = await tx.payment.create({
        data: {
          traiteurId,
          orderId,
          amount: input.amount,
          type: this.paymentType(order, settings, paid, input.amount),
          method: input.method,
          status: 'SUCCEEDED',
          reference: input.reference,
          paidAt: zonedToUtc(input.paidOn, '12:00', settings.timezone),
          recordedById: user.membershipId,
          notes: input.notes,
          receiptNumber: number.reference,
          receiptYear: number.year,
          receiptSequence: number.value,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.recorded',
          entityType: 'Payment',
          entityId: payment.id,
          after: {
            orderId,
            amount: input.amount,
            method: input.method,
            type: payment.type,
            receiptNumber: number.reference,
          },
          client,
        },
        tx,
      );
      return payment.id;
    });

    // Reçu figé juste après l'enregistrement, sans retarder la réponse ; s'il échoue, il est
    // produit au premier téléchargement (données de l'encaissement immuables).
    void this.storeReceipt(traiteurId, paymentId).catch((error: unknown) =>
      this.logger.warn(`Reçu de ${paymentId} non généré : ${String(error)}`),
    );
    return this.state(this.prisma, traiteurId, orderId);
  }

  async refund(
    user: AuthenticatedUser,
    orderId: string,
    input: RefundInput,
    client: ClientInfo,
  ): Promise<OrderPayments> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      await this.lockOrder(tx, traiteurId, orderId);
      this.assertDate(input.paidOn, settings.timezone);
      const paid = (await paymentTotals(tx, traiteurId, [orderId])).get(orderId)?.net ?? 0;
      if (input.amount > paid) {
        throw appErrors.badRequest(
          'REFUND_EXCEEDS_PAID',
          'Le remboursement dépasse le montant payé',
          {
            paid,
          },
        );
      }
      const payment = await tx.payment.create({
        data: {
          traiteurId,
          orderId,
          amount: input.amount,
          type: 'REFUND',
          method: input.method,
          status: 'SUCCEEDED',
          reference: input.reference,
          paidAt: zonedToUtc(input.paidOn, '12:00', settings.timezone),
          recordedById: user.membershipId,
          notes: input.notes,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.refunded',
          entityType: 'Payment',
          entityId: payment.id,
          after: { orderId, amount: input.amount, method: input.method },
          client,
        },
        tx,
      );
    });
    return this.state(this.prisma, traiteurId, orderId);
  }

  /** Annule un encaissement saisi par erreur : il ne compte plus, son reçu est marqué annulé. */
  async void(
    user: AuthenticatedUser,
    orderId: string,
    paymentId: string,
    input: VoidPaymentInput,
    client: ClientInfo,
  ): Promise<OrderPayments> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, traiteurId, orderId);
      const payment = await tx.payment.findFirst({ where: { id: paymentId, traiteurId, orderId } });
      if (!payment) throw appErrors.notFound('NOT_FOUND', 'Paiement introuvable');
      if (payment.voidedAt) throw appErrors.badRequest('PAYMENT_VOIDED', 'Paiement déjà annulé');
      await tx.payment.update({
        where: { id: paymentId },
        data: { voidedAt: new Date(), voidReason: input.reason, status: 'VOIDED' },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.voided',
          entityType: 'Payment',
          entityId: paymentId,
          before: {
            amount: payment.amount,
            type: payment.type,
            receiptNumber: payment.receiptNumber,
          },
          after: { reason: input.reason },
          client,
        },
        tx,
      );
    });
    return this.state(this.prisma, traiteurId, orderId);
  }

  async setDeposit(
    user: AuthenticatedUser,
    orderId: string,
    input: DepositUpdateInput,
    client: ClientInfo,
  ): Promise<OrderPayments> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, traiteurId, orderId);
      if (input.depositAmount > order.totalTtc) {
        throw appErrors.badRequest('VALIDATION_ERROR', 'L’acompte dépasse le total TTC');
      }
      await tx.order.update({
        where: { id_traiteurId: { id: orderId, traiteurId } },
        data: { depositAmount: input.depositAmount },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'order.deposit_changed',
          entityType: 'Order',
          entityId: orderId,
          before: { depositAmount: order.depositAmount },
          after: { depositAmount: input.depositAmount },
          client,
        },
        tx,
      );
    });
    return this.state(this.prisma, traiteurId, orderId);
  }

  /** Reçu PDF : celui figé à l'enregistrement ; un reçu annulé est rendu avec la mention ANNULÉ. */
  async receipt(user: AuthenticatedUser, orderId: string, paymentId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, traiteurId, orderId },
    });
    if (!payment?.receiptNumber) throw appErrors.notFound('NOT_FOUND', 'Reçu introuvable');
    const fileName = `${payment.receiptNumber}.pdf`;
    if (payment.voidedAt) {
      const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/receipts/${payment.receiptNumber}-annule.pdf`;
      const { pdf } = await this.renderReceipt(traiteurId, paymentId);
      await this.storage.putPrivate(key, pdf, 'application/pdf');
      return { url: await this.storage.signedDownloadUrl(key, fileName), fileName };
    }
    const key = payment.receiptPdfKey ?? (await this.storeReceipt(traiteurId, paymentId));
    return { url: await this.storage.signedDownloadUrl(key, fileName), fileName };
  }

  // ─────────────────────────── Interne ───────────────────────────

  /** Génère et stocke le reçu (une seule fois) ; retourne sa clé. */
  private async storeReceipt(traiteurId: string, paymentId: string): Promise<string> {
    const existing = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { receiptPdfKey: true, receiptNumber: true },
    });
    if (existing.receiptPdfKey) return existing.receiptPdfKey;
    const { pdf, sha256 } = await this.renderReceipt(traiteurId, paymentId);
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/receipts/${existing.receiptNumber ?? paymentId}.pdf`;
    await this.storage.putPrivate(key, pdf, 'application/pdf');
    // Renseigné une seule fois (garanti par la base) : deux générations concurrentes sont identiques
    await this.prisma.payment.updateMany({
      where: { id: paymentId, receiptPdfKey: null },
      data: { receiptPdfKey: key, receiptPdfSha256: sha256 },
    });
    this.logger.log(
      `Reçu ${existing.receiptNumber ?? paymentId} (${DOCUMENT_TEMPLATE_VERSION}) stocké`,
    );
    return key;
  }

  private async renderReceipt(traiteurId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { id: paymentId, traiteurId },
      include: { order: { select: orderSelect } },
    });
    const seller = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: sellerSelect,
    });
    const settings = await this.settings(this.prisma, traiteurId);
    // Payé à la date de ce reçu : paiements comptés enregistrés jusqu'à celui-ci inclus
    const before = await this.prisma.payment.findMany({
      where: {
        traiteurId,
        orderId: payment.orderId,
        ...COUNTED_PAYMENT,
        createdAt: { lte: payment.createdAt },
      },
      select: { amount: true, type: true },
    });
    const paidSoFar = before.reduce(
      (sum, row) => sum + (row.type === 'REFUND' ? -row.amount : row.amount),
      0,
    );
    const schedule = orderSchedule(payment.order, settings, paidSoFar);
    const locale = payment.order.client.locale === 'ar' ? 'ar' : 'fr';
    const logo = await this.logo(seller);
    return this.pdf.render(
      receiptDocument({
        locale,
        seller,
        hasLogo: logo !== null,
        receiptNumber: payment.receiptNumber ?? '',
        payment: {
          type: payment.type,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference,
          paidAt: payment.paidAt ?? payment.createdAt,
          voidedReason: payment.voidReason,
        },
        order: payment.order,
        client: {
          name: `${payment.order.client.firstName} ${payment.order.client.lastName}`.trim(),
          phone: payment.order.client.user.phone,
        },
        paidSoFar,
        remaining: schedule.remaining,
      }),
      logo,
    );
  }

  private async logo(seller: Seller): Promise<Buffer | null> {
    if (!seller.logoKey) return null;
    try {
      return await this.storage.download(seller.logoKey);
    } catch (error) {
      this.logger.warn(`Logo illisible (${seller.logoKey}) : ${String(error)}`);
      return null;
    }
  }

  private async state(db: Db, traiteurId: string, orderId: string): Promise<OrderPayments> {
    const [order, settings, rows] = await Promise.all([
      db.order.findFirst({ where: { id: orderId, traiteurId }, select: orderSelect }),
      this.settings(db, traiteurId),
      db.payment.findMany({
        where: { traiteurId, orderId },
        include: paymentInclude,
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    const totals = (await paymentTotals(db, traiteurId, [orderId])).get(orderId);
    const schedule = orderSchedule(order, settings, totals?.net ?? 0);
    const deposit = schedule.installments.find((item) => item.kind === 'DEPOSIT');
    return {
      schedule,
      depositAmount: order.depositAmount > 0 ? order.depositAmount : (deposit?.amount ?? 0),
      depositLocked: order.depositAmount > 0,
      received: totals?.received ?? 0,
      refunded: totals?.refunded ?? 0,
      cancellationFee: order.cancellationFeeAmount,
      payments: rows.map((row) => this.toPayment(row, settings.timezone)),
    };
  }

  private toPayment(row: PaymentRow, timeZone: string): Payment {
    return {
      id: row.id,
      type: row.type,
      method: row.method,
      amount: row.amount,
      reference: row.reference,
      paidOn: utcToZoned(row.paidAt ?? row.createdAt, timeZone).date,
      receiptNumber: row.receiptNumber,
      voided: row.voidedAt !== null,
      voidReason: row.voidReason,
      recordedBy: row.recordedBy
        ? `${row.recordedBy.firstName} ${row.recordedBy.lastName}`.trim()
        : null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Nature d'un encaissement selon l'échéancier au moment où il est saisi. */
  private paymentType(
    order: OrderForPayment,
    settings: { timezone: string; depositPercentBps: number; balanceDueDays: number },
    paidBefore: number,
    amount: number,
  ): PaymentType {
    const schedule = orderSchedule(order, settings, paidBefore);
    if (paidBefore === 0 && amount >= order.totalTtc) return 'FULL';
    const deposit = schedule.installments.find((item) => item.kind === 'DEPOSIT');
    if (deposit && deposit.remaining > 0) return 'DEPOSIT';
    return schedule.installments.some((item) => item.kind === 'FULL') ? 'FULL' : 'BALANCE';
  }

  private assertDate(paidOn: string, timeZone: string): void {
    if (paidOn > todayInTimeZone(timeZone)) {
      throw appErrors.badRequest('PAYMENT_DATE_INVALID', 'La date ne peut pas être dans le futur');
    }
  }

  /** Verrouille la commande : les encaissements d'une même commande sont sérialisés. */
  private async lockOrder(tx: Db, traiteurId: string, orderId: string): Promise<OrderForPayment> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    return tx.order.findFirstOrThrow({ where: { id: orderId, traiteurId }, select: orderSelect });
  }

  private settings(db: Db, traiteurId: string) {
    return db.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: settingsSelect });
  }
}
