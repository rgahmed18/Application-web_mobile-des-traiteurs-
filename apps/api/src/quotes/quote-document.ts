import { amountToWords, computeDocumentTotals, type PriceMode } from '@traiteur/shared';

import type { DocumentModel } from '../pdf/document-model';
import { auto, ltr } from '../pdf/document-model';
import { amount, capitalize, type DocLocale, localDate, money, rate } from '../pdf/format';
import { docLabels } from '../pdf/labels';
import { type Seller, sellerFooter, sellerHeader } from '../pdf/seller';
import type { QuoteSnapshot } from './quote-snapshot';

export interface QuoteLineData {
  label: string;
  quantity: number;
  unitPriceHt: number;
  unitPriceTtc: number;
  discountHt: number;
  discountTtc: number;
  taxRateBps: number;
  totalHt: number;
  taxAmount: number;
  totalTtc: number;
}

export interface QuoteDocumentData {
  locale: DocLocale;
  seller: Seller;
  hasLogo: boolean;
  reference: string;
  version: number;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  validUntil: string;
  priceMode: PriceMode;
  notes: string | null;
  snapshot: QuoteSnapshot;
  lines: QuoteLineData[];
  /** Mention d'accord imprimée dans la zone de signature (devis accepté). */
  acceptance: { mode: 'ONLINE' | 'PHONE' | 'PAPER' | 'OTHER'; name: string; date: string } | null;
}

/** Devis (DEV-…, version n), dans la langue choisie pour le client. */
export function quoteDocument(data: QuoteDocumentData): DocumentModel {
  const t = docLabels(data.locale);
  const { snapshot, seller, locale } = data;
  const ttc = data.priceMode === 'TTC';
  const vat = seller.isVatRegistered;
  const totals = computeDocumentTotals(data.lines);
  const event = snapshot.event;

  const time = event.endTime
    ? `${t.from} ${ltr(event.startTime)} ${t.to} ${ltr(event.endTime)}${event.endsNextDay ? ` ${t.nextDay}` : ''}`
    : ltr(event.startTime);
  // Adresse d'un seul tenant : en latin, elle reste dans l'ordre même dans un document arabe
  const venue = auto(
    [event.venueName, event.venueAddress, event.city]
      .filter((part): part is string => Boolean(part))
      .join(', '),
  );

  const watermark: Partial<Record<QuoteDocumentData['status'], string>> = {
    DRAFT: t.draft,
    SUPERSEDED: t.superseded,
    EXPIRED: t.expired,
    REJECTED: t.rejected,
  };

  const dueText = (item: QuoteSnapshot['schedule'][number]) =>
    item.dueDate ? `${t.before} ${localDate(item.dueDate)}` : t.atConfirmation;
  const scheduleLabels = { DEPOSIT: t.deposit, BALANCE: t.balance, FULL: t.full };

  const sections: NonNullable<DocumentModel['sections']> = [];
  if (snapshot.schedule.length > 0) {
    sections.push({
      title: t.schedule,
      items: snapshot.schedule.map((item) =>
        t.scheduleLine(scheduleLabels[item.kind], money(item.amount, locale), dueText(item)),
      ),
    });
  }
  const terms = snapshot.terms[locale];
  if (terms) {
    sections.push({
      title: t.conditions,
      items: terms
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
        .filter((line) => line !== '')
        .map(auto),
    });
  }
  if (data.notes) sections.push({ title: t.notes, items: [auto(data.notes)], bullets: false });

  const acceptance = data.acceptance
    ? data.acceptance.mode === 'ONLINE'
      ? t.acceptedOnline(auto(data.acceptance.name), localDate(data.acceptance.date))
      : t.acceptedManually(auto(data.acceptance.name), localDate(data.acceptance.date))
    : null;

  return {
    lang: locale,
    title: t.quote,
    number: data.reference,
    hasLogo: data.hasLogo,
    watermark: watermark[data.status] ?? null,
    meta: [
      [t.issuedOn, localDate(snapshot.issuedOn)],
      [t.validUntil, localDate(data.validUntil)],
      [t.version, ltr(data.version)],
      [t.order, ltr(snapshot.orderReference)],
    ],
    seller: sellerHeader(seller),
    parties: [
      {
        title: t.client,
        lines: [
          auto(snapshot.client.name),
          ltr(snapshot.client.phone),
          ...(snapshot.client.email ? [ltr(snapshot.client.email)] : []),
        ],
      },
      {
        title: t.event,
        lines: [
          `${t.eventTypes[event.type]} — ${t.guests(event.guestCount)}`,
          `${localDate(event.date)} ${time}`,
          venue,
        ],
      },
    ],
    table: {
      columns: [
        { label: t.description, align: 'start', width: 'fill' },
        { label: t.quantity, align: 'center', width: 'auto' },
        { label: ttc ? t.unitPriceTtc : t.unitPriceHt, align: 'end', width: 'auto' },
        ...(vat ? [{ label: t.taxRate, align: 'center' as const, width: 'auto' as const }] : []),
        { label: ttc ? t.totalTtcColumn : t.totalHtColumn, align: 'end', width: 'auto' },
      ],
      rows: data.lines.map((line) => {
        const discount = ttc ? line.discountTtc : line.discountHt;
        return [
          {
            main: auto(line.label),
            sub: discount > 0 ? t.discountOf(money(discount, locale)) : null,
          },
          ltr(line.quantity),
          amount(ttc ? line.unitPriceTtc : line.unitPriceHt),
          ...(vat ? [rate(line.taxRateBps)] : []),
          amount(ttc ? line.totalTtc : line.totalHt),
        ];
      }),
    },
    taxSummary: vat
      ? {
          title: t.taxSummary,
          columns: [t.taxRateColumn, t.taxBase, t.taxAmount],
          rows: totals.taxBreakdown.map((entry) => [
            rate(entry.taxRateBps),
            money(entry.baseHt, locale),
            money(entry.taxAmount, locale),
          ]),
        }
      : null,
    totals: vat
      ? [
          { label: t.totalHt, value: money(totals.totalHt, locale) },
          { label: t.totalTax, value: money(totals.totalTax, locale) },
          { label: t.totalTtc, value: money(totals.totalTtc, locale), strong: true },
        ]
      : [{ label: t.totalTtc, value: money(totals.totalTtc, locale), strong: true }],
    amountInWords: t.amountInWordsQuote(capitalize(amountToWords(totals.totalTtc, locale))),
    sections: vat
      ? sections
      : [{ title: t.notVatRegistered, items: [], bullets: false }, ...sections],
    signature: { title: t.signature, hint: t.signatureHint, signedBy: acceptance },
    footer: sellerFooter(seller, locale),
  };
}
