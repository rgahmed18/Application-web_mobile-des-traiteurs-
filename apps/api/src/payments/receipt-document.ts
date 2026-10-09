import { amountToWords, utcToZoned } from '@traiteur/shared';

import type { DocumentModel } from '../pdf/document-model';
import { auto, ltr } from '../pdf/document-model';
import { capitalize, type DocLocale, localDate, money } from '../pdf/format';
import { docLabels } from '../pdf/labels';
import { type Seller, sellerFooter, sellerHeader } from '../pdf/seller';

export interface ReceiptData {
  locale: DocLocale;
  seller: Seller;
  hasLogo: boolean;
  receiptNumber: string;
  payment: {
    type: 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND';
    method: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD';
    amount: number;
    reference: string | null;
    paidAt: Date;
    voidedReason: string | null;
  };
  order: { reference: string; eventDate: Date; totalTtc: number };
  client: { name: string; phone: string };
  /** Payé net après ce paiement, et reste à payer à ce moment-là. */
  paidSoFar: number;
  remaining: number;
}

/** Reçu de paiement numéroté (REC-…), dans la langue du client. */
export function receiptDocument(data: ReceiptData): DocumentModel {
  const t = docLabels(data.locale);
  const { payment, seller } = data;
  const tz = seller.timezone;
  return {
    lang: data.locale,
    title: t.receipt,
    number: data.receiptNumber,
    hasLogo: data.hasLogo,
    watermark: payment.voidedReason ? t.voided : null,
    meta: [
      [t.date, localDate(utcToZoned(payment.paidAt, tz).date)],
      [t.order, ltr(data.order.reference)],
    ],
    seller: sellerHeader(seller),
    parties: [
      { title: t.client, lines: [auto(data.client.name), ltr(data.client.phone)] },
      { title: t.event, lines: [localDate(utcToZoned(data.order.eventDate, tz).date)] },
    ],
    table: {
      columns: [
        { label: t.paymentFor, align: 'start', width: 'fill' },
        { label: t.paymentMethod, align: 'start', width: 'auto' },
        { label: t.paymentReference, align: 'start', width: 'auto' },
        { label: t.amountReceived, align: 'end', width: 'auto' },
      ],
      rows: [
        [
          { main: t.paymentTypes[payment.type], sub: `${t.order} ${ltr(data.order.reference)}` },
          t.methods[payment.method],
          payment.reference ? auto(payment.reference) : '—',
          money(payment.amount, data.locale),
        ],
      ],
    },
    totals: [
      { label: t.amountReceived, value: money(payment.amount, data.locale), strong: true },
      { label: t.paidSoFar, value: money(data.paidSoFar, data.locale) },
      { label: t.remaining, value: money(data.remaining, data.locale) },
    ],
    amountInWords: t.amountInWordsReceipt(capitalize(amountToWords(payment.amount, data.locale))),
    sections: payment.voidedReason
      ? [{ title: t.voided, items: [t.voidedReason(payment.voidedReason)], bullets: false }]
      : [],
    signature: null,
    footer: sellerFooter(seller, data.locale),
  };
}
