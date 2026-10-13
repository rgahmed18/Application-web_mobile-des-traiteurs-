import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  type CashDesk,
  type CashRejectInput,
  type CollectionMethod,
  type Download,
  type MissionCollectInput,
  utcToZoned,
} from '@traiteur/shared';
import sharp from 'sharp';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextDocumentNumber } from '../sequences/document-sequence';
import { detectImageType } from '../storage/image-processing';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';
import { paymentTotals } from './payment-state';
import { PAYABLE, PaymentsService } from './payments.service';

type Db = Prisma.TransactionClient;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Déclaration en attente de remise : déclarée par un livreur, ni remise ni refusée. */
const PENDING_DECLARATION = {
  status: 'PENDING',
  collectedAt: { not: null },
  voidedAt: null,
} satisfies Prisma.PaymentWhereInput;

const deskInclude = {
  order: {
    select: {
      reference: true,
      eventDate: true,
      client: { select: { firstName: true, lastName: true } },
    },
  },
  collectedBy: {
    select: { id: true, firstName: true, lastName: true, user: { select: { phone: true } } },
  },
  assignment: { select: { cashToCollect: true } },
} satisfies Prisma.PaymentInclude;

export interface PhotoFile {
  buffer: Buffer;
  size: number;
}

/**
 * Caisse livreurs. Le livreur déclare ce qu'il a encaissé à la livraison (espèces ou chèque, photo
 * du chèque facultative) : un paiement « en attente de remise » est créé, qui ne compte pas encore.
 * L'administrateur le valide quand il récupère l'argent (il compte alors, avec son reçu numéroté)
 * ou le refuse avec un motif (le livreur peut déclarer à nouveau).
 */
@Injectable()
export class CashDeskService {
  private readonly logger = new Logger(CashDeskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly storage: StorageService,
  ) {}

  /** Déclaration du livreur (mission déjà vérifiée par l'appelant : la sienne, encaissable). */
  async declare(
    user: AuthenticatedUser,
    assignment: { id: string; orderId: string },
    input: MissionCollectInput,
    photo: PhotoFile | undefined,
    client: ClientInfo,
  ): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    const chequePhotoKey =
      photo && photo.size > 0 && input.method === 'CHEQUE'
        ? await this.storePhoto(traiteurId, photo)
        : null;
    await this.prisma.$transaction(async (tx) => {
      const settings = await this.payments.settings(tx, traiteurId);
      const order = await this.payments.lockOrder(tx, traiteurId, assignment.orderId);
      if (!PAYABLE.includes(order.status)) {
        throw appErrors.badRequest('MISSION_NOT_ALLOWED', 'Commande annulée');
      }
      const live = await tx.payment.count({
        where: { assignmentId: assignment.id, collectedAt: { not: null }, voidedAt: null },
      });
      if (live > 0) {
        throw appErrors.conflict('CASH_DECLARED', 'Encaissement déjà déclaré pour cette mission');
      }
      const paid = (await paymentTotals(tx, traiteurId, [order.id])).get(order.id)?.net ?? 0;
      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          traiteurId,
          orderId: order.id,
          amount: input.amount,
          // Nature provisoire, recalculée à la remise selon l'échéancier du moment
          type: this.payments.paymentType(order, settings, paid, input.amount),
          method: input.method,
          status: 'PENDING',
          reference: input.reference,
          paidAt: now,
          assignmentId: assignment.id,
          collectedById: user.membershipId,
          collectedAt: now,
          chequePhotoKey,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.collected',
          entityType: 'Payment',
          entityId: payment.id,
          after: {
            orderId: order.id,
            assignmentId: assignment.id,
            amount: input.amount,
            method: input.method,
            withPhoto: chequePhotoKey !== null,
          },
          client,
        },
        tx,
      );
    });
  }

  /** Montants déclarés non encore remis, par livreur. */
  async desk(user: AuthenticatedUser): Promise<CashDesk> {
    const traiteurId = requireTraiteurId(user);
    const { timezone } = await this.payments.settings(this.prisma, traiteurId);
    const rows = await this.prisma.payment.findMany({
      where: { traiteurId, ...PENDING_DECLARATION },
      include: deskInclude,
      orderBy: { collectedAt: 'asc' },
    });
    const drivers = new Map<string, CashDesk['drivers'][number]>();
    for (const row of rows) {
      const key = row.collectedById ?? 'unknown';
      const member = row.collectedBy;
      const driver = drivers.get(key) ?? {
        membershipId: member?.id ?? null,
        name: member ? `${member.firstName} ${member.lastName}`.trim() : '—',
        phone: member?.user.phone ?? null,
        total: 0,
        cash: 0,
        cheques: 0,
        items: [],
      };
      driver.total += row.amount;
      if (row.method === 'CHEQUE') driver.cheques += row.amount;
      else driver.cash += row.amount;
      driver.items.push({
        paymentId: row.id,
        orderId: row.orderId,
        orderReference: row.order.reference,
        eventDate: utcToZoned(row.order.eventDate, timezone).date,
        clientName: `${row.order.client.firstName} ${row.order.client.lastName}`.trim(),
        amount: row.amount,
        method: row.method as CollectionMethod,
        reference: row.reference,
        collectedAt: (row.collectedAt ?? row.createdAt).toISOString(),
        hasPhoto: row.chequePhotoKey !== null,
        expectedAmount: row.assignment?.cashToCollect ?? null,
      });
      drivers.set(key, driver);
    }
    const list = [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { total: list.reduce((sum, driver) => sum + driver.total, 0), drivers: list };
  }

  /** Argent récupéré : l'encaissement compte désormais, avec son reçu numéroté. */
  async remit(user: AuthenticatedUser, paymentId: string, client: ClientInfo): Promise<CashDesk> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const pending = await this.pending(tx, traiteurId, paymentId);
      const settings = await this.payments.settings(tx, traiteurId);
      const order = await this.payments.lockOrder(tx, traiteurId, pending.orderId);
      if (!PAYABLE.includes(order.status)) {
        throw appErrors.badRequest(
          'PAYMENT_NOT_ALLOWED',
          'Commande annulée : refusez la déclaration et remboursez le client',
        );
      }
      const paid = (await paymentTotals(tx, traiteurId, [order.id])).get(order.id)?.net ?? 0;
      if (paid + pending.amount > order.totalTtc) {
        throw appErrors.badRequest(
          'PAYMENT_EXCEEDS_TOTAL',
          'Le total payé dépasserait le total TTC',
          { remaining: order.totalTtc - paid },
        );
      }
      const number = await nextDocumentNumber(tx, {
        traiteurId,
        type: 'RECEIPT',
        timeZone: settings.timezone,
      });
      // Statut vérifié dans la requête : une double validation ne numérote pas deux reçus
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, traiteurId, ...PENDING_DECLARATION },
        data: {
          status: 'SUCCEEDED',
          type: this.payments.paymentType(order, settings, paid, pending.amount),
          receiptNumber: number.reference,
          receiptYear: number.year,
          receiptSequence: number.value,
          remittedAt: new Date(),
          recordedById: user.membershipId,
        },
      });
      if (count === 0) throw this.notPending();
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.remitted',
          entityType: 'Payment',
          entityId: paymentId,
          after: {
            orderId: order.id,
            amount: pending.amount,
            method: pending.method,
            collectedById: pending.collectedById,
            receiptNumber: number.reference,
          },
          client,
        },
        tx,
      );
    });
    void this.payments
      .storeReceipt(traiteurId, paymentId)
      .catch((error: unknown) =>
        this.logger.warn(`Reçu de ${paymentId} non généré : ${String(error)}`),
      );
    return this.desk(user);
  }

  /** Montant non reçu ou déclaration erronée : annulée avec son motif, jamais comptée. */
  async reject(
    user: AuthenticatedUser,
    paymentId: string,
    input: CashRejectInput,
    client: ClientInfo,
  ): Promise<CashDesk> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const pending = await this.pending(tx, traiteurId, paymentId);
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, traiteurId, ...PENDING_DECLARATION },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: input.reason },
      });
      if (count === 0) throw this.notPending();
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'payment.collection_rejected',
          entityType: 'Payment',
          entityId: paymentId,
          before: {
            orderId: pending.orderId,
            amount: pending.amount,
            collectedById: pending.collectedById,
          },
          after: { reason: input.reason },
          client,
        },
        tx,
      );
    });
    return this.desk(user);
  }

  /** Photo du chèque : URL signée (5 minutes). */
  async chequePhoto(user: AuthenticatedUser, paymentId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, traiteurId },
      select: { chequePhotoKey: true, reference: true },
    });
    if (!payment?.chequePhotoKey) throw appErrors.notFound('NOT_FOUND', 'Photo introuvable');
    const fileName = `cheque-${payment.reference ?? paymentId}.jpg`.replace(/[^\w.-]/g, '_');
    return {
      url: await this.storage.signedDownloadUrl(payment.chequePhotoKey, fileName),
      fileName,
    };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async pending(tx: Db, traiteurId: string, paymentId: string) {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, traiteurId, collectedAt: { not: null } },
    });
    if (!payment) throw appErrors.notFound('NOT_FOUND', 'Déclaration introuvable');
    if (payment.status !== 'PENDING' || payment.voidedAt) throw this.notPending();
    return payment;
  }

  private notPending() {
    return appErrors.conflict('CASH_NOT_PENDING', 'Cette déclaration a déjà été traitée');
  }

  /** Photo réencodée en JPEG (orientation corrigée, métadonnées et position GPS supprimées). */
  private async storePhoto(traiteurId: string, photo: PhotoFile): Promise<string> {
    if (photo.size > MAX_PHOTO_BYTES || !detectImageType(photo.buffer)) {
      throw appErrors.badRequest(
        'CHEQUE_PHOTO_INVALID',
        'Photo illisible (JPEG, PNG ou WebP, 10 Mo au plus)',
      );
    }
    let jpeg: Buffer;
    try {
      jpeg = await sharp(photo.buffer, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      throw appErrors.badRequest('CHEQUE_PHOTO_INVALID', 'Photo illisible');
    }
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/cheques/${randomUUID()}.jpg`;
    await this.storage.putPrivate(key, jpeg, 'image/jpeg');
    return key;
  }
}
