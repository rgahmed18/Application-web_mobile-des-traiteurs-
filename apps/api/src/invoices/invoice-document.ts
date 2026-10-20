import {
  amountToWords,
  getLocalizedText,
  type InvoiceKind,
  type LineLabel,
  lineLabelText,
  type LocalizedText,
} from '@traiteur/shared';

import type { DocumentModel } from '../pdf/document-model';
import { auto, ltr } from '../pdf/document-model';
import { amount, capitalize, type DocLocale, localDate, money, rate } from '../pdf/format';
import { docLabels } from '../pdf/labels';
import { sellerFooter, sellerHeader } from '../pdf/seller';
import type { BuyerSnapshot, SellerSnapshot } from './invoice-snapshots';

export interface InvoiceDocumentData {
  locale: DocLocale;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  hasLogo: boolean;
  type: 'INVOICE' | 'CREDIT_NOTE';
  kind: InvoiceKind;
  number: string;
  issuedOn: string;
  dueDate: string | null;
  orderReference: string;
  event: {
    /** Nom du type d'événement (liste du traiteur). */
    typeName: LocalizedText;
    date: string;
  };
  original: { number: string; issuedOn: string } | null;
  reason: string | null;
  notes: string | null;
  lines: {
    label: LineLabel;
    quantity: number;
    unitPriceHt: number;
    discountHt: number;
    taxRateBps: number;
    totalHt: number;
  }[];
  totals: {
    totalHt: number;
    totalTax: number;
    totalTtc: number;
    taxBreakdown: { taxRateBps: number; baseHt: number; taxAmount: number }[];
  };
}

/**
 * Facture (totale, d'acompte, de solde, de frais d'annulation) ou avoir, avec les mentions
 * obligatoires : identité complète du vendeur (pied de page), client et son ICE s'il s'agit
 * d'une entreprise, lignes HT, récapitulatif de TVA par taux, totaux, échéance, pénalités de
 * retard (loi 69-21) et montant en lettres.
 */
export function invoiceDocument(data: InvoiceDocumentData): DocumentModel {
  const t = docLabels(data.locale);
  const { seller, buyer, locale } = data;
  const credit = data.type === 'CREDIT_NOTE';
  const vat = seller.isVatRegistered;
  const titles: Record<InvoiceKind, string> = {
    TOTAL: t.invoice,
    DEPOSIT: t.depositInvoice,
    BALANCE: t.balanceInvoice,
    CANCELLATION_FEE: t.cancellationInvoice,
  };

  const meta: [string, string][] = [
    [t.issueDate, localDate(data.issuedOn)],
    ...(credit
      ? []
      : ([[t.dueDate, data.dueDate ? localDate(data.dueDate) : t.atReception]] as [
          string,
          string,
        ][])),
    ...(data.original
      ? ([[t.originalInvoice, ltr(data.original.number)]] as [string, string][])
      : []),
    [t.order, ltr(data.orderReference)],
  ];

  const buyerLines = [
    ...(buyer.companyName ? [auto(buyer.companyName)] : []),
    auto(buyer.name),
    ...(buyer.ice ? [`${t.legal.ice} ${ltr(buyer.ice)}`] : []),
    ...(buyer.address ? [auto(buyer.address)] : []),
    ltr(buyer.phone),
  ];

  const sections: NonNullable<DocumentModel['sections']> = [];
  if (credit && data.original) {
    sections.push({
      title: t.creditReason,
      items: [
        t.creditFor(ltr(data.original.number), localDate(data.original.issuedOn)),
        ...(data.reason ? [auto(data.reason)] : []),
      ],
      bullets: false,
    });
  }
  if (!vat) sections.push({ title: t.notVatRegistered, items: [], bullets: false });
  if (!credit) {
    sections.push({
      title: t.paymentTerms,
      items: [
        ...(seller.paymentTerms
          ? seller.paymentTerms
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line !== '')
              .map(auto)
          : []),
        t.latePenalties,
      ],
      bullets: false,
    });
  }
  if (data.notes) sections.push({ title: t.notes, items: [auto(data.notes)], bullets: false });

  const words = capitalize(amountToWords(Math.abs(data.totals.totalTtc), locale));
  return {
    lang: locale,
    title: credit ? t.creditNote : titles[data.kind],
    number: data.number,
    hasLogo: data.hasLogo,
    watermark: null,
    meta,
    seller: sellerHeader(seller),
    parties: [
      { title: t.buyer, lines: buyerLines },
      {
        title: t.event,
        lines: [
          `${getLocalizedText(data.event.typeName, data.locale)} — ${localDate(data.event.date)}`,
        ],
      },
    ],
    table: {
      columns: [
        { label: t.description, align: 'start', width: 'fill' },
        { label: t.quantity, align: 'center', width: 'auto' },
        { label: vat ? t.unitPriceHt : t.unitPrice, align: 'end', width: 'auto' },
        ...(vat ? [{ label: t.taxRate, align: 'center' as const, width: 'auto' as const }] : []),
        { label: vat ? t.totalHtColumn : t.totalColumn, align: 'end', width: 'auto' },
      ],
      rows: data.lines.map((line) => [
        {
          main: auto(lineLabelText(line.label, locale)),
          // Remise HT de la ligne : P.U. × Qté − remise = total HT
          sub: line.discountHt > 0 ? t.discountOf(money(line.discountHt, locale)) : null,
        },
        ltr(line.quantity),
        amount(line.unitPriceHt),
        ...(vat ? [rate(line.taxRateBps)] : []),
        amount(line.totalHt),
      ]),
    },
    taxSummary: vat
      ? {
          title: t.taxSummary,
          columns: [t.taxRateColumn, t.taxBase, t.taxAmount],
          rows: data.totals.taxBreakdown.map((entry) => [
            rate(entry.taxRateBps),
            money(entry.baseHt, locale),
            money(entry.taxAmount, locale),
          ]),
        }
      : null,
    totals: vat
      ? [
          { label: t.totalHt, value: money(data.totals.totalHt, locale) },
          { label: t.totalTax, value: money(data.totals.totalTax, locale) },
          { label: t.totalTtc, value: money(data.totals.totalTtc, locale), strong: true },
        ]
      : [{ label: t.totalTtc, value: money(data.totals.totalTtc, locale), strong: true }],
    amountInWords: credit ? t.amountInWordsCredit(words) : t.amountInWordsInvoice(words),
    sections,
    signature: null,
    footer: sellerFooter(seller, locale),
  };
}
