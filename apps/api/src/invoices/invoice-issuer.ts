import {
  addDays,
  formatTaxRate,
  type InvoiceKind,
  lineLabelText,
  todayInTimeZone,
  utcToZoned,
  zonedToUtc,
} from '@traiteur/shared';

import { appErrors } from '../common/errors';
import { readLineLabel } from '../documents/line-label';
import type { Prisma } from '../generated/prisma/client';
import { localizedTerms } from '../pdf/seller';
import { type DocLabels, docLabels, inAllLocales } from '../pdf/labels';
import { nextDocumentNumber } from '../sequences/document-sequence';
import {
  cancellationFeeLines,
  copyLines,
  deductionLines,
  depositLines,
  fullCreditLines,
  type InvoiceLineDraft,
  invoiceTotals,
  partialCreditLines,
  type StoredLine,
} from './invoice-lines';
import {
  buyerSelect,
  buyerSnapshot,
  invoiceSellerSelect,
  sellerSnapshot,
} from './invoice-snapshots';

/**
 * Émission des factures et avoirs, dans la transaction de l'appelant (commande verrouillée).
 * Utilisé par le module factures et par l'annulation d'une commande (avoir du remboursement).
 *
 * Règles :
 * - facture totale, ou facture d'acompte puis facture de solde (lignes − acomptes facturés) ;
 *   seulement pour une commande confirmée (ou au-delà) ;
 * - frais d'annulation : commande annulée, montant conservé non encore facturé ;
 * - avoir total d'une facture (motif), ou avoir du remboursement à l'annulation ;
 * - numéro continu (FAC-…, AV-… ou série partagée), date d'émission imposée par la base.
 */

type Db = Prisma.TransactionClient;

const FIRM = ['CONFIRMED', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

export const invoiceInclude = {
  lines: { orderBy: { sortOrder: 'asc' } },
  originalInvoice: { select: { number: true, issuedAt: true } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

const orderSelect = {
  id: true,
  reference: true,
  status: true,
  priceMode: true,
  totalTtc: true,
  depositAmount: true,
  cancellationFeeAmount: true,
  eventDate: true,
  clientId: true,
  items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export type Availability = Record<InvoiceKind, number | null>;

export interface InvoicingState {
  order: OrderRow;
  invoices: InvoiceRow[];
  /** Avoirs émis par facture d'origine (somme ≤ 0). */
  credited: Map<string, number>;
  available: Availability;
  invoicedTtc: number;
}

/** Facture encore « vivante » : pas entièrement annulée par des avoirs. */
function isActive(invoice: InvoiceRow, credited: Map<string, number>): boolean {
  return invoice.type === 'INVOICE' && invoice.totalTtc + (credited.get(invoice.id) ?? 0) > 0;
}

export async function invoicingState(
  db: Db,
  traiteurId: string,
  orderId: string,
): Promise<InvoicingState> {
  const order = await db.order.findFirst({
    where: { id: orderId, traiteurId },
    select: orderSelect,
  });
  if (!order) throw appErrors.notFound('NOT_FOUND', 'Commande introuvable');
  const invoices = await db.invoice.findMany({
    where: { traiteurId, orderId },
    include: invoiceInclude,
    orderBy: [{ issuedAt: 'asc' }, { sequenceNumber: 'asc' }],
  });
  const credited = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.type === 'CREDIT_NOTE' && invoice.originalInvoiceId) {
      credited.set(
        invoice.originalInvoiceId,
        (credited.get(invoice.originalInvoiceId) ?? 0) + invoice.totalTtc,
      );
    }
  }
  const active = invoices.filter((invoice) => isActive(invoice, credited));
  const activeKinds = new Set(active.map((invoice) => invoice.kind));
  const invoicedTtc = invoices.reduce((sum, invoice) => sum + invoice.totalTtc, 0);
  const firm = FIRM.includes(order.status) && order.totalTtc > 0;

  // Acomptes déductibles d'un solde : facturés et jamais corrigés par un avoir
  const deposits = active.filter((invoice) => invoice.kind === 'DEPOSIT');
  const untouched = deposits.every((invoice) => !credited.has(invoice.id));
  const depositsTtc = deposits.reduce((sum, invoice) => sum + invoice.totalTtc, 0);
  const balance = order.totalTtc - depositsTtc;
  const fee = order.cancellationFeeAmount - invoicedTtc;

  return {
    order,
    invoices,
    credited,
    invoicedTtc,
    available: {
      TOTAL: firm && active.length === 0 ? order.totalTtc : null,
      DEPOSIT:
        firm &&
        active.length === 0 &&
        order.depositAmount > 0 &&
        order.depositAmount < order.totalTtc
          ? order.depositAmount
          : null,
      BALANCE:
        firm &&
        deposits.length > 0 &&
        untouched &&
        !activeKinds.has('BALANCE') &&
        !activeKinds.has('TOTAL') &&
        balance > 0
          ? balance
          : null,
      CANCELLATION_FEE:
        order.status === 'CANCELLED' && fee > 0 && !activeKinds.has('CANCELLATION_FEE')
          ? fee
          : null,
    },
  };
}

/** Lignes lues en base, libellés typés (LocalizedText). */
function stored<T extends Omit<StoredLine, 'label'> & { label: Prisma.JsonValue }>(
  lines: readonly T[],
): (T & StoredLine)[] {
  return lines.map((line) => ({ ...line, label: readLineLabel(line.label) }));
}

/**
 * Libellé produit par l'application, dans toutes les langues, suivi du taux de TVA quand le
 * document en compte plusieurs.
 */
const rateLabel = (base: (t: DocLabels) => string) => (rate: number, several: boolean) =>
  inAllLocales((t) => (several ? `${base(t)}${t.rateSuffix(formatTaxRate(rate))}` : base(t)));

/** Pourcentage lisible d'un acompte (« 30 % », « 29,5 % »). */
function percentOf(part: number, total: number): string {
  const value = Math.round((part * 10_000) / total) / 100;
  return `${value.toString().replace('.', ',')} %`;
}

interface CreateParams {
  traiteurId: string;
  order: OrderRow;
  type: 'INVOICE' | 'CREDIT_NOTE';
  kind: InvoiceKind;
  priceMode: 'HT' | 'TTC';
  lines: InvoiceLineDraft[];
  locale: 'fr' | 'ar';
  dueDay: string | null;
  notes: string | null;
  original?: { id: string } | null;
  reason?: string | null;
}

/** Numéro, instantanés et lignes : la facture est complète dès sa création (immuable). */
async function createInvoice(tx: Db, params: CreateParams): Promise<string> {
  const { traiteurId, order } = params;
  const seller = await tx.traiteur.findUniqueOrThrow({
    where: { id: traiteurId },
    select: invoiceSellerSelect,
  });
  const buyer = await tx.membership.findFirstOrThrow({
    where: { id: order.clientId, traiteurId },
    select: buyerSelect,
  });
  const sequence =
    params.type === 'CREDIT_NOTE' && seller.creditNoteNumbering === 'SEPARATE'
      ? 'CREDIT_NOTE'
      : 'INVOICE';
  const number = await nextDocumentNumber(tx, {
    traiteurId,
    type: sequence,
    timeZone: seller.timezone,
  });
  const totals = invoiceTotals(params.lines);
  const created = await tx.invoice.create({
    data: {
      traiteurId,
      orderId: order.id,
      type: params.type,
      kind: params.kind,
      number: number.reference,
      year: number.year,
      sequenceNumber: number.value,
      originalInvoiceId: params.original?.id ?? null,
      reason: params.reason ?? null,
      dueDate: params.dueDay ? zonedToUtc(params.dueDay, '00:00', seller.timezone) : null,
      priceMode: params.priceMode,
      totalHt: totals.totalHt,
      totalTax: totals.totalTax,
      totalTtc: totals.totalTtc,
      taxBreakdown: totals.taxBreakdown.map((entry) => ({ ...entry })),
      sellerSnapshot: sellerSnapshot(seller, localizedTerms(seller.paymentTerms, params.locale)),
      buyerSnapshot: buyerSnapshot(buyer),
      notes: params.notes,
      locale: params.locale,
      lines: {
        create: params.lines.map((line, index) => ({
          itemType: line.itemType,
          label: line.label,
          quantity: line.quantity,
          unitPriceHt: line.unitPriceHt,
          unitPriceTtc: line.unitPriceTtc,
          discountHt: line.discountHt,
          discountTtc: line.discountTtc,
          taxRateBps: line.taxRateBps,
          totalHt: line.totalHt,
          taxAmount: line.taxAmount,
          totalTtc: line.totalTtc,
          sortOrder: index,
        })),
      },
    },
  });
  return created.id;
}

async function invoiceContext(tx: Db, traiteurId: string, clientId: string) {
  const [seller, buyer, clock] = await Promise.all([
    tx.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select: invoiceSellerSelect }),
    tx.membership.findFirstOrThrow({
      where: { id: clientId, traiteurId },
      select: { locale: true },
    }),
    // Heure de la base : la même que la date d'émission imposée par le trigger, pour que
    // l'échéance soit calculée à partir du même jour
    tx.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`,
  ]);
  const locale: 'fr' | 'ar' = buyer.locale === 'ar' ? 'ar' : 'fr';
  return {
    seller,
    locale,
    today: todayInTimeZone(seller.timezone, clock[0]?.now ?? new Date()),
  };
}

/** Émet la facture demandée si elle est possible ; retourne son identifiant. */
export async function issueInvoice(
  tx: Db,
  params: { traiteurId: string; orderId: string; kind: InvoiceKind; notes: string | null },
): Promise<string> {
  const { traiteurId, kind } = params;
  const state = await invoicingState(tx, traiteurId, params.orderId);
  const amount = state.available[kind];
  if (amount === null) {
    throw appErrors.badRequest('INVOICE_NOT_AVAILABLE', 'Cette facture ne peut pas être émise');
  }
  const { order } = state;
  const { seller, locale, today } = await invoiceContext(tx, traiteurId, order.clientId);
  const eventDay = utcToZoned(order.eventDate, seller.timezone).date;
  const balanceDue = addDays(eventDay, -seller.balanceDueDays);

  let lines: InvoiceLineDraft[];
  let priceMode = order.priceMode;
  let dueDay: string | null = today;
  switch (kind) {
    case 'TOTAL':
      lines = copyLines(stored(order.items));
      dueDay = balanceDue > today ? balanceDue : today;
      break;
    case 'DEPOSIT':
      lines = depositLines(
        order.priceMode,
        amount,
        order.items,
        rateLabel((t) => t.depositLine(percentOf(amount, order.totalTtc), order.reference)),
      );
      break;
    case 'BALANCE': {
      const deposits = state.invoices.filter(
        (invoice) => invoice.kind === 'DEPOSIT' && isActive(invoice, state.credited),
      );
      lines = [
        ...copyLines(stored(order.items)),
        ...deductionLines(
          deposits.map((deposit) => ({ number: deposit.number, lines: stored(deposit.lines) })),
          (number, rate, several) => rateLabel((t) => t.deductedDeposit(number))(rate, several),
        ),
      ];
      dueDay = balanceDue > today ? balanceDue : today;
      break;
    }
    case 'CANCELLATION_FEE': {
      priceMode = 'TTC';
      const rate = seller.isVatRegistered
        ? (seller.cancellationFeeTaxRateBps ?? seller.defaultTaxRateBps)
        : 0;
      lines = cancellationFeeLines(
        amount,
        rate,
        inAllLocales((t) => t.cancellationFeeLine(order.reference)),
      );
      break;
    }
  }
  return createInvoice(tx, {
    traiteurId,
    order,
    type: 'INVOICE',
    kind,
    priceMode,
    lines,
    locale,
    dueDay,
    notes: params.notes,
  });
}

/** Avoir total d'une facture (annulation, erreur) : toutes ses lignes en négatif. */
export async function issueCreditNote(
  tx: Db,
  params: { traiteurId: string; invoiceId: string; reason: string },
): Promise<{ id: string; orderId: string }> {
  const { traiteurId } = params;
  const original = await tx.invoice.findFirst({
    where: { id: params.invoiceId, traiteurId },
    select: { id: true, orderId: true },
  });
  if (!original) throw appErrors.notFound('NOT_FOUND', 'Facture introuvable');
  const state = await invoicingState(tx, traiteurId, original.orderId);
  const invoice = state.invoices.find((item) => item.id === original.id);
  if (!invoice || invoice.type !== 'INVOICE') {
    throw appErrors.badRequest('INVOICE_NOT_AVAILABLE', 'Un avoir corrige une facture');
  }
  if (state.credited.has(invoice.id)) {
    throw appErrors.badRequest('INVOICE_ALREADY_CREDITED', 'Cette facture a déjà un avoir');
  }
  const id = await createInvoice(tx, {
    traiteurId,
    order: state.order,
    type: 'CREDIT_NOTE',
    kind: invoice.kind,
    priceMode: invoice.priceMode,
    lines: fullCreditLines(stored(invoice.lines)),
    locale: invoice.locale === 'ar' ? 'ar' : 'fr',
    dueDay: null,
    notes: null,
    original: invoice,
    reason: params.reason,
  });
  return { id, orderId: original.orderId };
}

/**
 * Annulation d'une commande avec remboursement : les factures déjà émises (acompte d'abord)
 * sont soldées par un avoir du montant remboursé. Retourne les numéros des avoirs émis.
 */
export async function creditOnCancellation(
  tx: Db,
  params: { traiteurId: string; orderId: string; refund: number; reason: string | null },
): Promise<string[]> {
  if (params.refund <= 0) return [];
  const state = await invoicingState(tx, params.traiteurId, params.orderId);
  const active = state.invoices
    .filter((invoice) => isActive(invoice, state.credited))
    .sort((a, b) => Number(b.kind === 'DEPOSIT') - Number(a.kind === 'DEPOSIT'));
  if (active.length === 0) return [];
  const { locale } = await invoiceContext(tx, params.traiteurId, state.order.clientId);
  const t = docLabels(locale);

  let remaining = params.refund;
  const numbers: string[] = [];
  for (const invoice of active) {
    if (remaining <= 0) break;
    const credited = state.credited.get(invoice.id) ?? 0;
    const open = invoice.totalTtc + credited;
    const amount = Math.min(remaining, open);
    const invoiceLines = stored(invoice.lines);
    const lines =
      amount === invoice.totalTtc && credited === 0
        ? fullCreditLines(invoiceLines).map((line) => ({
            ...line,
            label: inAllLocales(
              (labels, lang) =>
                `${labels.refundLine(invoice.number)} — ${lineLabelText(line.label, lang)}`,
            ),
          }))
        : partialCreditLines(
            invoice.priceMode,
            amount,
            invoiceLines,
            rateLabel((labels) => labels.refundLine(invoice.number)),
          );
    const id = await createInvoice(tx, {
      traiteurId: params.traiteurId,
      order: state.order,
      type: 'CREDIT_NOTE',
      kind: invoice.kind,
      priceMode: invoice.priceMode,
      lines,
      locale: invoice.locale === 'ar' ? 'ar' : 'fr',
      dueDay: null,
      notes: null,
      original: invoice,
      reason: params.reason ?? t.refundLine(invoice.number),
    });
    const created = await tx.invoice.findUniqueOrThrow({
      where: { id },
      select: { number: true, totalTtc: true },
    });
    numbers.push(created.number);
    remaining += created.totalTtc; // négatif
  }
  return numbers;
}
