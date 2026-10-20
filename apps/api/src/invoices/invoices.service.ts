import { Injectable, Logger } from '@nestjs/common';
import {
  type CreditNoteInput,
  type Download,
  type Invoice,
  type InvoiceExportQuery,
  type InvoiceIssueInput,
  type InvoiceListQuery,
  type InvoicePage,
  type OrderInvoicing,
  utcToZoned,
  zonedDayRange,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import { toLocalized } from '../catalog/catalog-common';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import { readLineLabel } from '../documents/line-label';
import type { Prisma } from '../generated/prisma/client';
import { DOCUMENT_TEMPLATE_VERSION, PdfService } from '../pdf/pdf.service';
import { sellerSelect } from '../pdf/seller';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';
import { invoiceDocument } from './invoice-document';
import { invoicesCsv, invoicesXlsx } from './invoice-export';
import { invoiceInclude, invoicingState, issueCreditNote, issueInvoice } from './invoice-issuer';
import { parseBuyer, parseSeller, type SellerSnapshot } from './invoice-snapshots';

type Db = Prisma.TransactionClient;

const listInclude = {
  order: { select: { reference: true } },
  originalInvoice: { select: { number: true } },
  creditNotes: { select: { totalTtc: true } },
} satisfies Prisma.InvoiceInclude;
type ListRow = Prisma.InvoiceGetPayload<{ include: typeof listInclude }>;

export interface ExportFile {
  body: Buffer;
  fileName: string;
  contentType: string;
}

const MAX_EXPORT_ROWS = 10_000;

/**
 * Factures et avoirs : émission (règles dans invoice-issuer.ts), PDF généré une seule fois et
 * stocké (empreinte SHA-256, version du gabarit), liste et export comptable.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
  ) {}

  async forOrder(user: AuthenticatedUser, orderId: string): Promise<OrderInvoicing> {
    const traiteurId = requireTraiteurId(user);
    const result = await this.state(this.prisma, traiteurId, orderId);
    // Avoirs émis à l'annulation d'une commande : PDF produit dès la première consultation
    for (const invoice of result.invoices) {
      void this.ensurePdf(traiteurId, invoice.id).catch((error: unknown) =>
        this.logger.warn(`PDF de ${invoice.number} non généré : ${String(error)}`),
      );
    }
    return result;
  }

  async issue(
    user: AuthenticatedUser,
    orderId: string,
    input: InvoiceIssueInput,
    client: ClientInfo,
  ): Promise<OrderInvoicing> {
    const traiteurId = requireTraiteurId(user);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, traiteurId, orderId);
      const invoiceId = await issueInvoice(tx, {
        traiteurId,
        orderId,
        kind: input.kind,
        notes: input.notes,
      });
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'invoice.issued',
          entityType: 'Invoice',
          entityId: invoiceId,
          after: {
            orderId,
            number: invoice.number,
            kind: invoice.kind,
            totalTtc: invoice.totalTtc,
          },
          client,
        },
        tx,
      );
      return invoiceId;
    });
    await this.pdfAfterCommit(traiteurId, id);
    return this.state(this.prisma, traiteurId, orderId);
  }

  /** Avoir total d'une facture : motif obligatoire, imprimé sur l'avoir. */
  async creditNote(
    user: AuthenticatedUser,
    invoiceId: string,
    input: CreditNoteInput,
    client: ClientInfo,
  ): Promise<OrderInvoicing> {
    const traiteurId = requireTraiteurId(user);
    const created = await this.prisma.$transaction(async (tx) => {
      const original = await tx.invoice.findFirst({
        where: { id: invoiceId, traiteurId },
        select: { orderId: true, number: true },
      });
      if (!original) throw appErrors.notFound('NOT_FOUND', 'Facture introuvable');
      await this.lockOrder(tx, traiteurId, original.orderId);
      const result = await issueCreditNote(tx, { traiteurId, invoiceId, reason: input.reason });
      const credit = await tx.invoice.findUniqueOrThrow({ where: { id: result.id } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'invoice.credit_note_issued',
          entityType: 'Invoice',
          entityId: result.id,
          after: {
            orderId: result.orderId,
            number: credit.number,
            original: original.number,
            reason: input.reason,
            totalTtc: credit.totalTtc,
          },
          client,
        },
        tx,
      );
      return result;
    });
    await this.pdfAfterCommit(traiteurId, created.id);
    return this.state(this.prisma, traiteurId, created.orderId);
  }

  async pdfDownload(user: AuthenticatedUser, invoiceId: string): Promise<Download> {
    const traiteurId = requireTraiteurId(user);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, traiteurId },
      select: { number: true },
    });
    if (!invoice) throw appErrors.notFound('NOT_FOUND', 'Facture introuvable');
    const key = await this.ensurePdf(traiteurId, invoiceId);
    const fileName = `${invoice.number}.pdf`;
    return { url: await this.storage.signedDownloadUrl(key, fileName), fileName };
  }

  async list(user: AuthenticatedUser, query: InvoiceListQuery): Promise<InvoicePage> {
    const traiteurId = requireTraiteurId(user);
    const timeZone = await this.timeZone(traiteurId);
    const where = this.listWhere(traiteurId, query, timeZone);
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: listInclude,
        orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toInvoice(row, timeZone)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Export comptable (ordre chronologique des numéros), xlsx ou CSV. */
  async export(user: AuthenticatedUser, query: InvoiceExportQuery): Promise<ExportFile> {
    const traiteurId = requireTraiteurId(user);
    const timeZone = await this.timeZone(traiteurId);
    const rows = await this.prisma.invoice.findMany({
      where: this.listWhere(traiteurId, query, timeZone),
      include: listInclude,
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
      take: MAX_EXPORT_ROWS,
    });
    const invoices = rows.map((row) => this.toInvoice(row, timeZone));
    const period = [query.from, query.to].filter(Boolean).join('_') || 'tout';
    const base = `factures_${period}`;
    return query.format === 'csv'
      ? {
          body: invoicesCsv(invoices),
          fileName: `${base}.csv`,
          contentType: 'text/csv; charset=utf-8',
        }
      : {
          body: await invoicesXlsx(invoices),
          fileName: `${base}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async state(db: Db, traiteurId: string, orderId: string): Promise<OrderInvoicing> {
    const [state, timeZone] = await Promise.all([
      invoicingState(db, traiteurId, orderId),
      this.timeZone(traiteurId),
    ]);
    const ids = state.invoices.map((invoice) => invoice.id);
    const rows = await db.invoice.findMany({
      where: { traiteurId, id: { in: ids } },
      include: listInclude,
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
    });
    return {
      invoices: rows.map((row) => this.toInvoice(row, timeZone)),
      available: state.available,
      invoicedTtc: state.invoicedTtc,
    };
  }

  private toInvoice(row: ListRow, timeZone: string): Invoice {
    const buyer = parseBuyer(row.buyerSnapshot);
    return {
      id: row.id,
      orderId: row.orderId,
      orderReference: row.order.reference,
      type: row.type,
      kind: row.kind,
      number: row.number,
      issuedAt: row.issuedAt.toISOString(),
      issuedOn: utcToZoned(row.issuedAt, timeZone).date,
      dueDate: row.dueDate ? utcToZoned(row.dueDate, timeZone).date : null,
      clientName: buyer.companyName ? `${buyer.companyName} (${buyer.name})` : buyer.name,
      clientIce: buyer.ice,
      totalHt: row.totalHt,
      totalTax: row.totalTax,
      totalTtc: row.totalTtc,
      taxBreakdown: parseBreakdown(row.taxBreakdown),
      originalNumber: row.originalInvoice?.number ?? null,
      reason: row.reason,
      creditedTtc: row.creditNotes.reduce((sum, credit) => sum + credit.totalTtc, 0),
      locale: row.locale === 'ar' ? 'ar' : 'fr',
    };
  }

  private listWhere(
    traiteurId: string,
    query: Omit<InvoiceListQuery, 'page' | 'pageSize'>,
    timeZone: string,
  ): Prisma.InvoiceWhereInput {
    const issuedAt: Prisma.DateTimeFilter = {};
    if (query.from) issuedAt.gte = zonedDayRange(query.from, timeZone).start;
    if (query.to) issuedAt.lt = zonedDayRange(query.to, timeZone).end;
    const search = query.search?.trim();
    return {
      traiteurId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to ? { issuedAt } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { order: { reference: { contains: search, mode: 'insensitive' } } },
              { buyerSnapshot: { path: ['name'], string_contains: search } },
              { buyerSnapshot: { path: ['companyName'], string_contains: search } },
              { buyerSnapshot: { path: ['ice'], string_contains: search } },
            ],
          }
        : {}),
    };
  }

  /**
   * PDF juste après le commit (jamais sous verrou). La facture est émise quoi qu'il arrive :
   * un échec du rendu ou du stockage est repris au premier téléchargement et, sinon, par la
   * reprise automatique (DocumentRecoveryProcessor).
   */
  private async pdfAfterCommit(traiteurId: string, invoiceId: string): Promise<void> {
    try {
      await this.ensurePdf(traiteurId, invoiceId);
    } catch (error) {
      this.logger.warn(
        `PDF de la facture ${invoiceId} différé (reprise automatique) : ${String(error)}`,
      );
    }
  }

  /** PDF de la facture : généré une seule fois puis servi tel quel (jamais régénéré). */
  async ensurePdf(traiteurId: string, invoiceId: string): Promise<string> {
    const existing = await this.prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, traiteurId },
      select: { pdfKey: true, number: true },
    });
    if (existing.pdfKey) return existing.pdfKey;
    const { pdf, sha256 } = await this.render(traiteurId, invoiceId);
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/invoices/${existing.number}.pdf`;
    await this.storage.putPrivate(key, pdf, 'application/pdf');
    // Renseigné une seule fois (garanti par la base) ; deux rendus concurrents sont identiques
    await this.prisma.invoice.updateMany({
      where: { id: invoiceId, pdfKey: null },
      data: { pdfKey: key, pdfSha256: sha256, pdfTemplate: DOCUMENT_TEMPLATE_VERSION },
    });
    this.logger.log(`${existing.number} (${DOCUMENT_TEMPLATE_VERSION}) stocké`);
    return key;
  }

  private async render(traiteurId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, traiteurId },
      include: {
        ...invoiceInclude,
        order: {
          select: {
            reference: true,
            eventTypeRef: { select: { name: true } },
            eventDate: true,
          },
        },
      },
    });
    // Instantané du vendeur figé à l'émission (données antérieures : fiche actuelle)
    const seller: SellerSnapshot =
      parseSeller(invoice.sellerSnapshot) ??
      ({
        ...(await this.prisma.traiteur.findUniqueOrThrow({
          where: { id: traiteurId },
          select: sellerSelect,
        })),
        paymentTerms: null,
      } satisfies SellerSnapshot);
    const timeZone = seller.timezone;
    const logo = await this.logo(seller.logoKey);
    const locale = invoice.locale === 'ar' ? 'ar' : 'fr';
    return this.pdf.render(
      invoiceDocument({
        locale,
        seller,
        buyer: parseBuyer(invoice.buyerSnapshot),
        hasLogo: logo !== null,
        type: invoice.type,
        kind: invoice.kind,
        number: invoice.number,
        issuedOn: utcToZoned(invoice.issuedAt, timeZone).date,
        dueDate: invoice.dueDate ? utcToZoned(invoice.dueDate, timeZone).date : null,
        orderReference: invoice.order.reference,
        event: {
          typeName: toLocalized(invoice.order.eventTypeRef.name),
          date: utcToZoned(invoice.order.eventDate, timeZone).date,
        },
        original: invoice.originalInvoice
          ? {
              number: invoice.originalInvoice.number,
              issuedOn: utcToZoned(invoice.originalInvoice.issuedAt, timeZone).date,
            }
          : null,
        reason: invoice.reason,
        notes: invoice.notes,
        lines: invoice.lines.map((line) => ({ ...line, label: readLineLabel(line.label) })),
        totals: {
          totalHt: invoice.totalHt,
          totalTax: invoice.totalTax,
          totalTtc: invoice.totalTtc,
          taxBreakdown: parseBreakdown(invoice.taxBreakdown),
        },
      }),
      logo,
    );
  }

  private async logo(key: string | null): Promise<Buffer | null> {
    if (!key) return null;
    try {
      return await this.storage.download(key);
    } catch (error) {
      this.logger.warn(`Logo illisible (${key}) : ${String(error)}`);
      return null;
    }
  }

  private async lockOrder(tx: Db, traiteurId: string, orderId: string): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid AND "traiteurId" = ${traiteurId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
  }

  private async timeZone(traiteurId: string): Promise<string> {
    const traiteur = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { timezone: true },
    });
    return traiteur.timezone;
  }
}

/** Récapitulatif de TVA enregistré (JSON vérifié par la base). */
function parseBreakdown(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const { taxRateBps, baseHt, taxAmount } = entry;
    return typeof taxRateBps === 'number' &&
      typeof baseHt === 'number' &&
      typeof taxAmount === 'number'
      ? [{ taxRateBps, baseHt, taxAmount }]
      : [];
  });
}
