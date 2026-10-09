import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  amountToWords,
  computeDocumentTotals,
  type Download,
  type ManualAcceptanceInput,
  plannedDeposit,
  type PublicAcceptInput,
  type PublicQuote,
  type PublicRejectInput,
  type Quote,
  type QuoteCreateInput,
  type QuoteLink,
  type QuoteSendResult,
  type QuoteUpdateInput,
  todayInTimeZone,
  utcToZoned,
  zonedToUtc,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Env } from '../config/env.schema';
import type { LineDraft } from '../documents/document-lines';
import { DocumentLinesService } from '../documents/document-lines.service';
import type { OrderItem, OrderStatus, Prisma } from '../generated/prisma/client';
import { dayAvailability, hasConflict, lockDay } from '../orders/availability';
import { capitalize } from '../pdf/format';
import { DOCUMENT_TEMPLATE_VERSION, PdfService } from '../pdf/pdf.service';
import { type Seller, sellerSelect } from '../pdf/seller';
import { PrismaService } from '../prisma/prisma.service';
import { nextDocumentNumber } from '../sequences/document-sequence';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';
import { quoteDocument } from './quote-document';
import { hashLinkToken, hasOpenQuote, newLinkToken, revokeLinks } from './quote-lifecycle';
import {
  buildSnapshot,
  parseSnapshot,
  type QuoteSnapshot,
  snapshotOrderSelect,
  snapshotSettingsSelect,
  validityEnd,
} from './quote-snapshot';

type Db = Prisma.TransactionClient;

const quoteInclude = {
  lines: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  links: { select: { expiresAt: true, revokedAt: true, viewCount: true } },
} satisfies Prisma.QuoteInclude;
type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

const settingsSelect = {
  ...snapshotSettingsSelect,
  maxEventsPerDay: true,
  quoteValidityDays: true,
} satisfies Prisma.TraiteurSelect;
type QuoteSettings = Prisma.TraiteurGetPayload<{ select: typeof settingsSelect }>;

/** Statuts de commande pour lesquels on prépare un devis. */
const QUOTABLE: readonly OrderStatus[] = [
  'DRAFT',
  'PENDING',
  'QUOTED',
  'CONFIRMED',
  'IN_PREPARATION',
];
/** Un devis accepté confirme la commande tant qu'elle n'est pas déjà ferme. */
const CONFIRMABLE: readonly OrderStatus[] = ['PENDING', 'QUOTED'];

/** Un lien expiré reste consultable 30 jours (statut « expiré »), puis renvoie 404. */
const LINK_GRACE_DAYS = 30;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const MODE_TEXT = {
  ONLINE: 'en ligne',
  PHONE: 'accord téléphonique',
  PAPER: 'devis papier signé',
  OTHER: 'autre accord',
} as const;

interface AcceptanceRecord {
  mode: 'ONLINE' | 'PHONE' | 'PAPER' | 'OTHER';
  name: string;
  ip: string | null;
  userAgent: string | null;
  note: string | null;
  attachmentKey: string | null;
  recordedBy: string | null;
  actor: AuthenticatedUser | null;
}

export interface QuotePdf {
  pdf: Buffer;
  fileName: string;
}

/**
 * Devis : versions (DEV-… v1, v2) préparées depuis les lignes de la commande, envoi (PDF figé,
 * lien sécurisé), accord en ligne ou enregistré par le traiteur, refus, expiration.
 *
 * Effets sur la commande : envoi → « Devis envoyé » ; accord → « Confirmée » si la date est
 * libre, sinon accord enregistré et date à confirmer par le traiteur ; refus ou expiration →
 * retour « En attente » s'il ne reste aucun devis en cours.
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lines: DocumentLinesService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('PUBLIC_WEB_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ─────────────────────────── Back-office ───────────────────────────

  async list(user: AuthenticatedUser, orderId: string): Promise<Quote[]> {
    const traiteurId = requireTraiteurId(user);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, traiteurId },
      select: { id: true },
    });
    if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    await this.expireDue({ traiteurId, orderId });
    const [rows, settings] = await Promise.all([
      this.prisma.quote.findMany({
        where: { traiteurId, orderId },
        include: quoteInclude,
        orderBy: { version: 'desc' },
      }),
      this.settings(this.prisma, traiteurId),
    ]);
    return rows.map((row) => this.toQuote(row, settings.timezone));
  }

  /**
   * Prépare une version à partir des lignes actuelles de la commande. Un brouillon existant est
   * mis à jour ; sinon nouvelle version (même référence DEV-…, version + 1).
   */
  async create(
    user: AuthenticatedUser,
    orderId: string,
    input: QuoteCreateInput,
    client: ClientInfo,
  ): Promise<Quote> {
    const traiteurId = requireTraiteurId(user);
    const id = await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const order = await this.lockOrder(tx, traiteurId, orderId);
      if (!QUOTABLE.includes(order.status)) {
        throw appErrors.badRequest('QUOTE_ORDER_STATE', 'Pas de devis pour une commande clôturée');
      }
      if (order.items.length === 0) {
        throw appErrors.badRequest('LINES_REQUIRED', 'Ajoutez au moins une ligne à la commande');
      }
      const today = todayInTimeZone(settings.timezone);
      const validUntil = addDays(today, input.validityDays ?? settings.quoteValidityDays);
      const locale = input.locale ?? (order.client.locale === 'ar' ? 'ar' : 'fr');
      const latest = await tx.quote.findFirst({
        where: { traiteurId, orderId },
        orderBy: { version: 'desc' },
      });

      let quoteId: string;
      if (latest?.status === 'DRAFT') {
        quoteId = latest.id;
        await tx.quote.update({
          where: { id_traiteurId: { id: quoteId, traiteurId } },
          data: {
            validUntil: zonedToUtc(validUntil, '00:00', settings.timezone),
            locale,
            notes: input.notes,
          },
        });
      } else {
        const reference =
          latest?.reference ??
          (await nextDocumentNumber(tx, { traiteurId, type: 'QUOTE', timeZone: settings.timezone }))
            .reference;
        const created = await tx.quote.create({
          data: {
            traiteurId,
            orderId,
            reference,
            version: (latest?.version ?? 0) + 1,
            status: 'DRAFT',
            priceMode: order.priceMode,
            locale,
            validUntil: zonedToUtc(validUntil, '00:00', settings.timezone),
            notes: input.notes,
          },
        });
        quoteId = created.id;
      }
      await this.copyOrderLines(tx, traiteurId, quoteId, order.items);
      const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'quote.prepared',
          entityType: 'Quote',
          entityId: quoteId,
          after: {
            orderId,
            reference: quote.reference,
            version: quote.version,
            totalTtc: quote.totalTtc,
          },
          client,
        },
        tx,
      );
      return quoteId;
    });
    return this.get(traiteurId, id);
  }

  /** Validité, langue et remarques d'un brouillon. */
  async update(
    user: AuthenticatedUser,
    quoteId: string,
    input: QuoteUpdateInput,
    client: ClientInfo,
  ): Promise<Quote> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const quote = await this.lockQuote(tx, traiteurId, quoteId);
      if (quote.status !== 'DRAFT') {
        throw appErrors.badRequest('QUOTE_NOT_DRAFT', 'Seul un brouillon se modifie');
      }
      if (input.validUntil < todayInTimeZone(settings.timezone)) {
        throw appErrors.badRequest('QUOTE_VALIDITY_INVALID', 'La validité est déjà dépassée');
      }
      await tx.quote.update({
        where: { id_traiteurId: { id: quoteId, traiteurId } },
        data: {
          validUntil: zonedToUtc(input.validUntil, '00:00', settings.timezone),
          locale: input.locale,
          notes: input.notes,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'quote.updated',
          entityType: 'Quote',
          entityId: quoteId,
          after: { ...input },
          client,
        },
        tx,
      );
    });
    return this.get(traiteurId, quoteId);
  }

  /**
   * Envoi : lignes reprises de la commande puis figées, instantané des informations affichées,
   * lien sécurisé ; les versions précédentes en cours passent « Remplacé ». La commande en
   * attente passe « Devis envoyé ». Le PDF est généré et stocké une fois pour toutes.
   */
  async send(
    user: AuthenticatedUser,
    quoteId: string,
    client: ClientInfo,
  ): Promise<QuoteSendResult> {
    const traiteurId = requireTraiteurId(user);
    const link = await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const quote = await this.lockQuote(tx, traiteurId, quoteId);
      if (quote.status !== 'DRAFT') {
        throw appErrors.badRequest('QUOTE_NOT_DRAFT', 'Ce devis a déjà été envoyé');
      }
      const order = await this.lockOrder(tx, traiteurId, quote.orderId);
      if (order.status === 'DRAFT') {
        throw appErrors.badRequest(
          'QUOTE_ORDER_STATE',
          'Passez la commande « En attente » avant d’envoyer le devis',
        );
      }
      if (!QUOTABLE.includes(order.status)) {
        throw appErrors.badRequest('QUOTE_ORDER_STATE', 'Pas de devis pour une commande clôturée');
      }
      if (order.items.length === 0) {
        throw appErrors.badRequest('LINES_REQUIRED', 'Ajoutez au moins une ligne à la commande');
      }
      const today = todayInTimeZone(settings.timezone);
      const validUntil = this.validUntil(quote, settings.timezone);
      if (validUntil < today) {
        throw appErrors.badRequest('QUOTE_VALIDITY_INVALID', 'La validité est déjà dépassée');
      }

      // Toujours les lignes actuelles de la commande
      const { totals } = await this.copyOrderLines(tx, traiteurId, quoteId, order.items);
      const snapshot = buildSnapshot({
        order: await tx.order.findFirstOrThrow({
          where: { id: quote.orderId, traiteurId },
          select: snapshotOrderSelect,
        }),
        settings,
        totalTtc: totals.totalTtc,
        today,
      });

      const now = new Date();
      const previous = await tx.quote.findMany({
        where: {
          traiteurId,
          orderId: quote.orderId,
          id: { not: quoteId },
          status: { in: ['SENT', 'ACCEPTED'] },
        },
        select: { id: true },
      });
      if (previous.length > 0) {
        const ids = previous.map((row) => row.id);
        await tx.quote.updateMany({
          where: { traiteurId, id: { in: ids } },
          data: {
            status: 'SUPERSEDED',
            supersededReason: 'NEW_VERSION',
            supersededAt: now,
            availabilityPending: false,
          },
        });
        await revokeLinks(tx, traiteurId, ids, now);
      }
      await tx.quote.update({
        where: { id_traiteurId: { id: quoteId, traiteurId } },
        data: { status: 'SENT', sentAt: now, snapshot },
      });
      if (order.status === 'PENDING') {
        await this.moveOrder(tx, {
          traiteurId,
          orderId: quote.orderId,
          from: 'PENDING',
          to: 'QUOTED',
          reason: `Devis ${quote.reference} v${quote.version} envoyé`,
          actorUserId: user.userId,
          actorName: await this.memberName(tx, traiteurId, user.userId),
        });
      }
      const created = await this.createLink(tx, traiteurId, quoteId, validUntil);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'quote.sent',
          entityType: 'Quote',
          entityId: quoteId,
          after: {
            orderId: quote.orderId,
            reference: quote.reference,
            version: quote.version,
            totalTtc: totals.totalTtc,
            superseded: previous.length,
          },
          client,
        },
        tx,
      );
      return created;
    });

    try {
      await this.storeSentPdf(traiteurId, quoteId);
    } catch (error) {
      // Produit au premier téléchargement (données du devis figées)
      this.logger.warn(`PDF du devis ${quoteId} non généré : ${String(error)}`);
    }
    return { quote: await this.get(traiteurId, quoteId), link };
  }

  /** Nouveau lien (le précédent est révoqué) : le jeton n'est affiché qu'une fois. */
  async renewLink(
    user: AuthenticatedUser,
    quoteId: string,
    client: ClientInfo,
  ): Promise<QuoteLink> {
    const traiteurId = requireTraiteurId(user);
    await this.expireDue({ traiteurId, quoteId });
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.settings(tx, traiteurId);
      const quote = await this.lockQuote(tx, traiteurId, quoteId);
      if (quote.status !== 'SENT' && quote.status !== 'ACCEPTED') {
        throw appErrors.badRequest('QUOTE_NOT_OPEN', 'Ce devis n’est plus en cours');
      }
      await revokeLinks(tx, traiteurId, [quoteId]);
      const today = todayInTimeZone(settings.timezone);
      const validUntil = this.validUntil(quote, settings.timezone);
      // Devis accepté : lien de consultation valable 30 jours
      const until =
        quote.status === 'ACCEPTED' && validUntil < addDays(today, 30)
          ? addDays(today, 30)
          : validUntil;
      const link = await this.createLink(tx, traiteurId, quoteId, until);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'quote.link_renewed',
          entityType: 'Quote',
          entityId: quoteId,
          after: { expiresAt: link.expiresAt },
          client,
        },
        tx,
      );
      return link;
    });
  }

  async revokeLink(user: AuthenticatedUser, quoteId: string, client: ClientInfo): Promise<Quote> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      await this.lockQuote(tx, traiteurId, quoteId);
      await revokeLinks(tx, traiteurId, [quoteId]);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'quote.link_revoked',
          entityType: 'Quote',
          entityId: quoteId,
          client,
        },
        tx,
      );
    });
    return this.get(traiteurId, quoteId);
  }

  /** PDF du devis : URL signée (5 minutes). */
  async pdfDownload(user: AuthenticatedUser, quoteId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    await this.expireDue({ traiteurId, quoteId });
    const { key, fileName } = await this.pdfKey(traiteurId, quoteId);
    return { url: await this.storage.signedDownloadUrl(key, fileName), fileName };
  }

  async attachmentDownload(user: AuthenticatedUser, quoteId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, traiteurId },
      select: { reference: true, version: true, acceptanceAttachmentKey: true },
    });
    if (!quote?.acceptanceAttachmentKey) {
      throw appErrors.notFound('NOT_FOUND', 'Pièce jointe introuvable');
    }
    const extension = quote.acceptanceAttachmentKey.split('.').pop() ?? 'pdf';
    const fileName = `${quote.reference}-v${quote.version}-accord.${extension}`;
    return {
      url: await this.storage.signedDownloadUrl(quote.acceptanceAttachmentKey, fileName),
      fileName,
    };
  }

  /**
   * Accord enregistré par le traiteur (téléphone, devis papier signé…) : même effet que
   * l'accord en ligne. Pièce jointe facultative (scan ou photo), stockée en privé.
   */
  async acceptManually(
    user: AuthenticatedUser,
    quoteId: string,
    input: ManualAcceptanceInput,
    file: { buffer: Buffer; size: number } | undefined,
    client: ClientInfo,
  ): Promise<Quote> {
    const traiteurId = requireTraiteurId(user);
    await this.expireDue({ traiteurId, quoteId });
    let attachmentKey: string | null = null;
    if (file && file.size > 0) {
      const extension = attachmentExtension(file);
      if (!extension || file.size > MAX_ATTACHMENT_BYTES) {
        throw appErrors.badRequest(
          'ATTACHMENT_INVALID',
          'Pièce jointe invalide (PDF, JPEG, PNG ou WebP, 10 Mo au plus)',
        );
      }
      attachmentKey = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/quotes/${quoteId}/accord-${randomUUID()}.${extension}`;
      await this.storage.putPrivate(attachmentKey, file.buffer, MIME_TYPES[extension]);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const recordedBy = await this.memberName(tx, traiteurId, user.userId);
        await this.accept(
          tx,
          traiteurId,
          quoteId,
          {
            mode: input.mode,
            name: input.name,
            ip: client.ipAddress,
            userAgent: client.userAgent,
            note: input.note,
            attachmentKey,
            recordedBy,
            actor: user,
          },
          client,
          // Un devis papier signé peut arriver après la fin de validité
          true,
        );
      });
    } catch (error) {
      if (attachmentKey) await this.storage.remove([attachmentKey]).catch(() => undefined);
      throw error;
    }
    return this.get(traiteurId, quoteId);
  }

  // ─────────────────────────── Page publique (sans connexion) ───────────────────────────

  async publicView(token: string, lang: 'fr' | 'ar' | null): Promise<PublicQuote> {
    const link = await this.findLink(token);
    await this.expireDue({ traiteurId: link.traiteurId, quoteId: link.quoteId });
    await this.prisma.quoteLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    return this.presentPublic(link, lang);
  }

  private async presentPublic(
    link: { traiteurId: string; quoteId: string },
    lang: 'fr' | 'ar' | null,
  ): Promise<PublicQuote> {
    const quote = await this.prisma.quote.findUniqueOrThrow({
      where: { id: link.quoteId },
      include: quoteInclude,
    });
    const snapshot = parseSnapshot(quote.snapshot);
    if (!snapshot) throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    const settings = await this.settings(this.prisma, link.traiteurId);
    const locale = lang ?? (quote.locale === 'ar' ? 'ar' : 'fr');
    const ttc = quote.priceMode === 'TTC';
    const totals = computeDocumentTotals(quote.lines);
    const deposit = snapshot.schedule.find((item) => item.kind !== 'BALANCE');
    return {
      reference: quote.reference,
      version: quote.version,
      // Un lien vers une version remplacée garde son statut : le client voit « remplacé »
      status: quote.status,
      locale: quote.locale === 'ar' ? 'ar' : 'fr',
      traiteur: snapshot.seller,
      clientName: snapshot.client.name,
      event: {
        type: snapshot.event.type,
        date: snapshot.event.date,
        startTime: snapshot.event.startTime,
        endTime: snapshot.event.endTime,
        endsNextDay: snapshot.event.endsNextDay,
        guestCount: snapshot.event.guestCount,
        venue: [snapshot.event.venueName, snapshot.event.venueAddress, snapshot.event.city]
          .filter((part): part is string => Boolean(part))
          .join(', '),
      },
      priceMode: quote.priceMode,
      lines: quote.lines.map((line) => ({
        label: line.label,
        quantity: line.quantity,
        unitPrice: ttc ? line.unitPriceTtc : line.unitPriceHt,
        discount: ttc ? line.discountTtc : line.discountHt,
        taxRateBps: line.taxRateBps,
        total: ttc ? line.totalTtc : line.totalHt,
      })),
      totalHt: totals.totalHt,
      totalTax: totals.totalTax,
      totalTtc: totals.totalTtc,
      taxBreakdown: totals.taxBreakdown,
      amountInWords: capitalize(amountToWords(totals.totalTtc, locale)),
      validUntil: this.validUntil(quote, settings.timezone),
      terms: snapshot.terms[locale],
      depositAmount: deposit?.kind === 'DEPOSIT' ? deposit.amount : 0,
      balanceDueDate: snapshot.schedule.find((item) => item.kind === 'BALANCE')?.dueDate ?? null,
      acceptance:
        quote.status === 'ACCEPTED' && quote.acceptedAt && quote.acceptedName
          ? { name: quote.acceptedName, at: quote.acceptedAt.toISOString() }
          : null,
      availabilityPending: quote.availabilityPending,
    };
  }

  async publicPdf(token: string): Promise<QuotePdf> {
    const link = await this.findLink(token);
    await this.expireDue({ traiteurId: link.traiteurId, quoteId: link.quoteId });
    const { key, fileName } = await this.pdfKey(link.traiteurId, link.quoteId);
    return { pdf: await this.storage.download(key), fileName };
  }

  async publicAccept(
    token: string,
    input: PublicAcceptInput,
    client: ClientInfo,
  ): Promise<PublicQuote> {
    const link = await this.findLink(token, true);
    await this.expireDue({ traiteurId: link.traiteurId, quoteId: link.quoteId });
    await this.prisma.$transaction((tx) =>
      this.accept(
        tx,
        link.traiteurId,
        link.quoteId,
        {
          mode: 'ONLINE',
          name: input.name,
          ip: client.ipAddress,
          userAgent: client.userAgent,
          note: null,
          attachmentKey: null,
          recordedBy: null,
          actor: null,
        },
        client,
        false,
      ),
    );
    return this.presentPublic(link, null);
  }

  async publicReject(
    token: string,
    input: PublicRejectInput,
    client: ClientInfo,
  ): Promise<PublicQuote> {
    const link = await this.findLink(token, true);
    await this.expireDue({ traiteurId: link.traiteurId, quoteId: link.quoteId });
    await this.prisma.$transaction(async (tx) => {
      const quote = await this.lockQuote(tx, link.traiteurId, link.quoteId);
      if (quote.status !== 'SENT') {
        throw appErrors.badRequest('QUOTE_NOT_OPEN', 'Ce devis n’est plus en cours');
      }
      await this.lockOrder(tx, link.traiteurId, quote.orderId);
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: input.reason },
      });
      await this.reopenOrder(
        tx,
        link.traiteurId,
        quote.orderId,
        `Devis ${quote.reference} v${quote.version} refusé par le client`,
        'client (en ligne)',
      );
      await this.audit.record(
        {
          traiteurId: link.traiteurId,
          actor: null,
          action: 'quote.rejected',
          entityType: 'Quote',
          entityId: quote.id,
          after: { reason: input.reason, via: 'online' },
          client,
        },
        tx,
      );
    });
    return this.presentPublic(link, null);
  }

  // ─────────────────────────── Expiration ───────────────────────────

  /**
   * Devis envoyés dont le dernier jour de validité est passé → « Expiré » ; la commande revient
   * « En attente » s'il ne reste aucun devis en cours. Appelée à chaque lecture (paresseuse) et
   * toutes les heures (tâche planifiée). Retourne le nombre de devis expirés.
   */
  async expireDue(
    scope: { traiteurId?: string; orderId?: string; quoteId?: string } = {},
  ): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.quote.findMany({
      where: {
        status: 'SENT',
        validUntil: { lt: now },
        ...(scope.traiteurId ? { traiteurId: scope.traiteurId } : {}),
        ...(scope.orderId ? { orderId: scope.orderId } : {}),
        ...(scope.quoteId ? { id: scope.quoteId } : {}),
      },
      select: {
        id: true,
        traiteurId: true,
        orderId: true,
        reference: true,
        version: true,
        validUntil: true,
        traiteur: { select: { timezone: true } },
      },
      take: 500,
    });
    let expired = 0;
    for (const quote of candidates) {
      const tz = quote.traiteur.timezone;
      if (!quote.validUntil || utcToZoned(quote.validUntil, tz).date >= todayInTimeZone(tz, now)) {
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, quote.traiteurId, quote.orderId);
        const { count } = await tx.quote.updateMany({
          where: { id: quote.id, status: 'SENT' },
          data: { status: 'EXPIRED' },
        });
        if (count === 0) return;
        expired += 1;
        await this.reopenOrder(
          tx,
          quote.traiteurId,
          quote.orderId,
          `Devis ${quote.reference} v${quote.version} expiré`,
          null,
        );
        await this.audit.record(
          {
            traiteurId: quote.traiteurId,
            actor: null,
            action: 'quote.expired',
            entityType: 'Quote',
            entityId: quote.id,
          },
          tx,
        );
      });
    }
    return expired;
  }

  // ─────────────────────────── Interne ───────────────────────────

  /** Accord (en ligne ou manuel) : devis accepté, commande confirmée si la date est libre. */
  private async accept(
    tx: Db,
    traiteurId: string,
    quoteId: string,
    record: AcceptanceRecord,
    client: ClientInfo,
    allowExpired: boolean,
  ): Promise<void> {
    const settings = await this.settings(tx, traiteurId);
    const quote = await this.lockQuote(tx, traiteurId, quoteId);
    const acceptable = quote.status === 'SENT' || (allowExpired && quote.status === 'EXPIRED');
    if (!acceptable) {
      throw quote.status === 'EXPIRED'
        ? appErrors.badRequest('QUOTE_EXPIRED', 'Ce devis a expiré')
        : appErrors.badRequest('QUOTE_NOT_OPEN', 'Ce devis n’est plus en cours');
    }
    const order = await this.lockOrder(tx, traiteurId, quote.orderId);
    const now = new Date();
    const label = `Devis ${quote.reference} v${quote.version}`;
    const actorName =
      record.mode === 'ONLINE' ? `${record.name} (client, en ligne)` : record.recordedBy;

    let availabilityPending = false;
    let confirmed = false;
    if (CONFIRMABLE.includes(order.status)) {
      const day = utcToZoned(order.eventDate, settings.timezone).date;
      await lockDay(tx, traiteurId, day);
      const availability = await dayAvailability(tx, traiteurId, day, settings, order.id);
      if (hasConflict(availability)) {
        // Date bloquée ou complète : l'accord est enregistré, le traiteur confirmera la date
        availabilityPending = true;
      } else {
        confirmed = true;
        await tx.order.update({
          where: { id_traiteurId: { id: order.id, traiteurId } },
          data: {
            status: 'CONFIRMED',
            confirmedAt: now,
            ...(order.depositAmount === 0
              ? { depositAmount: plannedDeposit(order.totalTtc, settings.depositPercentBps) }
              : {}),
          },
        });
        await tx.orderStatusChange.create({
          data: {
            traiteurId,
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'CONFIRMED',
            reason:
              record.mode === 'ONLINE'
                ? `${label} accepté en ligne`
                : `${label} : ${MODE_TEXT[record.mode]} de ${record.name}`,
            actorUserId: record.actor?.userId ?? null,
            actorName,
            createdAt: now,
          },
        });
      }
    }

    await tx.quote.update({
      where: { id: quoteId },
      data: {
        status: 'ACCEPTED',
        acceptedAt: now,
        acceptanceMode: record.mode,
        acceptedName: record.name,
        acceptedIp: record.ip,
        acceptedUserAgent: record.userAgent,
        acceptanceNote: record.note,
        acceptanceAttachmentKey: record.attachmentKey,
        acceptedByName: record.recordedBy,
        availabilityPending,
      },
    });
    await this.audit.record(
      {
        traiteurId,
        actor: record.actor,
        action: 'quote.accepted',
        entityType: 'Quote',
        entityId: quoteId,
        after: {
          orderId: order.id,
          mode: record.mode,
          name: record.name,
          note: record.note,
          attachment: record.attachmentKey !== null,
          orderConfirmed: confirmed,
          availabilityPending,
        },
        client,
      },
      tx,
    );
  }

  /** Commande « Devis envoyé » sans devis en cours → « En attente ». */
  private async reopenOrder(
    tx: Db,
    traiteurId: string,
    orderId: string,
    reason: string,
    actorName: string | null,
  ): Promise<void> {
    const order = await tx.order.findFirstOrThrow({
      where: { id: orderId, traiteurId },
      select: { status: true },
    });
    if (order.status !== 'QUOTED' || (await hasOpenQuote(tx, traiteurId, orderId))) return;
    await this.moveOrder(tx, {
      traiteurId,
      orderId,
      from: 'QUOTED',
      to: 'PENDING',
      reason,
      actorUserId: null,
      actorName,
    });
  }

  /** Transition automatique de la commande (envoi, refus, expiration), tracée. */
  private async moveOrder(
    tx: Db,
    change: {
      traiteurId: string;
      orderId: string;
      from: OrderStatus;
      to: OrderStatus;
      reason: string;
      actorUserId: string | null;
      actorName: string | null;
    },
  ): Promise<void> {
    await tx.order.update({
      where: { id_traiteurId: { id: change.orderId, traiteurId: change.traiteurId } },
      data: { status: change.to },
    });
    await tx.orderStatusChange.create({
      data: {
        traiteurId: change.traiteurId,
        orderId: change.orderId,
        fromStatus: change.from,
        toStatus: change.to,
        reason: change.reason,
        actorUserId: change.actorUserId,
        actorName: change.actorName,
      },
    });
  }

  private async createLink(
    tx: Db,
    traiteurId: string,
    quoteId: string,
    lastDay: string,
  ): Promise<QuoteLink> {
    const settings = await this.settings(tx, traiteurId);
    const { token, hash } = newLinkToken();
    const expiresAt = zonedToUtc(validityEnd(lastDay), '00:00', settings.timezone);
    await tx.quoteLink.create({ data: { traiteurId, quoteId, tokenHash: hash, expiresAt } });
    return { url: `${this.webUrl}/devis/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Lien public valide : existant et non révoqué. Consultable jusqu'à 30 jours après son
   * expiration (statut « expiré » affiché) ; `forAction` : accord ou refus, lien non expiré.
   */
  private async findLink(token: string, forAction = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    }
    const link = await this.prisma.quoteLink.findUnique({
      where: { tokenHash: hashLinkToken(token) },
    });
    const now = Date.now();
    const grace = LINK_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (!link || link.revokedAt || link.expiresAt.getTime() + grace <= now) {
      throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    }
    if (forAction && link.expiresAt.getTime() <= now) {
      throw appErrors.badRequest('QUOTE_EXPIRED', 'Ce devis a expiré');
    }
    return link;
  }

  /** Clé du PDF à servir selon le statut du devis (généré si besoin). */
  private async pdfKey(
    traiteurId: string,
    quoteId: string,
  ): Promise<{ key: string; fileName: string }> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, traiteurId },
      select: { reference: true, version: true, status: true, pdfKey: true },
    });
    if (!quote) throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    const base = `${quote.reference}-v${quote.version}`;
    const fileName = `${base}.pdf`;
    if (quote.status === 'SENT') {
      return { key: quote.pdfKey ?? (await this.storeSentPdf(traiteurId, quoteId)), fileName };
    }
    // Brouillon (aperçu), accepté (mention de l'accord) ou clos (mention en filigrane)
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/quotes/${base}-${quote.status.toLowerCase()}.pdf`;
    const { pdf } = await this.renderQuote(traiteurId, quoteId);
    await this.storage.putPrivate(key, pdf, 'application/pdf');
    return { key, fileName };
  }

  /** PDF tel qu'envoyé au client : généré et stocké une seule fois, avec son empreinte. */
  private async storeSentPdf(traiteurId: string, quoteId: string): Promise<string> {
    const quote = await this.prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { pdfKey: true, reference: true, version: true },
    });
    if (quote.pdfKey) return quote.pdfKey;
    const { pdf, sha256 } = await this.renderQuote(traiteurId, quoteId, 'SENT');
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/quotes/${quote.reference}-v${quote.version}.pdf`;
    await this.storage.putPrivate(key, pdf, 'application/pdf');
    await this.prisma.quote.updateMany({
      where: { id: quoteId, pdfKey: null },
      data: { pdfKey: key, pdfSha256: sha256, pdfTemplate: DOCUMENT_TEMPLATE_VERSION },
    });
    return key;
  }

  private async renderQuote(
    traiteurId: string,
    quoteId: string,
    asStatus?: 'SENT',
  ): Promise<{ pdf: Buffer; sha256: string }> {
    const quote = await this.prisma.quote.findFirstOrThrow({
      where: { id: quoteId, traiteurId },
      include: quoteInclude,
    });
    const [seller, settings] = await Promise.all([
      this.prisma.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: sellerSelect }),
      this.settings(this.prisma, traiteurId),
    ]);
    const locale = quote.locale === 'ar' ? 'ar' : 'fr';
    const snapshot: QuoteSnapshot =
      parseSnapshot(quote.snapshot) ??
      buildSnapshot({
        order: await this.prisma.order.findFirstOrThrow({
          where: { id: quote.orderId, traiteurId },
          select: snapshotOrderSelect,
        }),
        settings,
        totalTtc: quote.totalTtc,
        today: todayInTimeZone(settings.timezone),
      });
    const status = asStatus ?? quote.status;
    const logo = await this.logo(seller);
    return this.pdf.render(
      quoteDocument({
        locale,
        seller,
        hasLogo: logo !== null,
        reference: quote.reference,
        version: quote.version,
        status,
        validUntil: this.validUntil(quote, settings.timezone),
        priceMode: quote.priceMode,
        notes: quote.notes,
        snapshot,
        lines: quote.lines,
        acceptance:
          status === 'ACCEPTED' && quote.acceptanceMode && quote.acceptedAt
            ? {
                mode: quote.acceptanceMode,
                name: quote.acceptedName ?? '',
                date: utcToZoned(quote.acceptedAt, settings.timezone).date,
              }
            : null,
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

  /** Lignes de la commande recopiées dans le devis (brouillon), dans le même mode de prix. */
  private copyOrderLines(tx: Db, traiteurId: string, quoteId: string, items: OrderItem[]) {
    const drafts: LineDraft[] = items.map((item, index) => {
      const ttc = item.priceMode === 'TTC';
      return {
        itemType: item.itemType,
        label: item.label,
        quantity: item.quantity,
        unitPrice: ttc ? item.unitPriceTtc : item.unitPriceHt,
        discount: ttc ? item.discountTtc : item.discountHt,
        taxRateBps: item.taxRateBps,
        dishId: item.dishId,
        packageId: item.packageId,
        extraServiceId: item.extraServiceId,
        sortOrder: index,
      };
    });
    return this.lines.replaceLines({ kind: 'QUOTE', id: quoteId, traiteurId }, drafts, tx);
  }

  private async get(traiteurId: string, quoteId: string): Promise<Quote> {
    const [row, settings] = await Promise.all([
      this.prisma.quote.findFirst({ where: { id: quoteId, traiteurId }, include: quoteInclude }),
      this.settings(this.prisma, traiteurId),
    ]);
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    return this.toQuote(row, settings.timezone);
  }

  private toQuote(row: QuoteRow, timeZone: string): Quote {
    const now = Date.now();
    return {
      id: row.id,
      orderId: row.orderId,
      reference: row.reference,
      version: row.version,
      status: row.status,
      locale: row.locale === 'ar' ? 'ar' : 'fr',
      validUntil: this.validUntil(row, timeZone),
      notes: row.notes,
      totalHt: row.totalHt,
      totalTax: row.totalTax,
      totalTtc: row.totalTtc,
      sentAt: row.sentAt?.toISOString() ?? null,
      acceptance:
        row.acceptedAt && row.acceptanceMode
          ? {
              mode: row.acceptanceMode,
              name: row.acceptedName ?? '',
              at: row.acceptedAt.toISOString(),
              note: row.acceptanceNote,
              recordedBy: row.acceptedByName,
              hasAttachment: row.acceptanceAttachmentKey !== null,
            }
          : null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      availabilityPending: row.availabilityPending,
      supersededReason: row.supersededReason,
      linkActive: row.links.some((link) => !link.revokedAt && link.expiresAt.getTime() > now),
      linkViews: row.links.reduce((sum, link) => sum + link.viewCount, 0),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Dernier jour de validité « AAAA-MM-JJ » dans le fuseau du traiteur. */
  private validUntil(
    quote: { validUntil: Date | null; createdAt: Date },
    timeZone: string,
  ): string {
    return utcToZoned(quote.validUntil ?? quote.createdAt, timeZone).date;
  }

  private async lockQuote(tx: Db, traiteurId: string, quoteId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Quote" WHERE "id" = ${quoteId}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Devis introuvable');
    return tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
  }

  private async lockOrder(tx: Db, traiteurId: string, orderId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
    return tx.order.findFirstOrThrow({
      where: { id: orderId, traiteurId },
      select: {
        id: true,
        status: true,
        priceMode: true,
        totalTtc: true,
        depositAmount: true,
        eventDate: true,
        client: { select: { locale: true } },
        items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  private settings(db: Db, traiteurId: string): Promise<QuoteSettings> {
    return db.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: settingsSelect });
  }

  private async memberName(db: Db, traiteurId: string, userId: string): Promise<string | null> {
    const member = await db.membership.findFirst({
      where: { traiteurId, userId },
      select: {
        firstName: true,
        lastName: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!member) return null;
    const name = `${member.firstName} ${member.lastName}`.trim();
    return name || `${member.user.firstName} ${member.user.lastName}`.trim() || null;
  }
}

const MIME_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

/** Type réel du fichier, d'après ses premiers octets (l'extension et le type déclarés mentent). */
function attachmentExtension(file: { buffer: Buffer }): keyof typeof MIME_TYPES | null {
  const bytes = file.buffer;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}
