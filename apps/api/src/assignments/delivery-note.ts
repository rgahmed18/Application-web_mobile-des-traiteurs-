import { type LineLabel, lineLabelText } from '@traiteur/shared';

import { auto, type DocumentModel, joinAddress, ltr } from '../pdf/document-model';
import { type DocLocale, localDate } from '../pdf/format';
import { docLabels } from '../pdf/labels';
import { type Seller, sellerFooter, sellerHeader } from '../pdf/seller';

/**
 * Bon de livraison (sans prix) : adresse et contact sur place, contenu et quantités, matériel,
 * notes de service, et encadré de signature du client à la réception. Imprimé dans la langue
 * du client, qui le signe. Document de service : ni numéroté ni figé.
 */
export interface DeliveryNoteData {
  locale: DocLocale;
  seller: Seller;
  hasLogo: boolean;
  reference: string;
  eventType: 'WEDDING' | 'ENGAGEMENT' | 'BIRTHDAY' | 'AQIQA' | 'CORPORATE' | 'OTHER';
  date: string;
  startTime: string;
  /** Heure de livraison prévue (mission du chauffeur), sinon début de l'événement. */
  deliveryTime: string;
  guestCount: number;
  venue: { name: string | null; address: string; city: string };
  contact: { name: string; phone: string };
  lines: { label: LineLabel; quantity: number }[];
  equipment: string | null;
  serviceNotes: string | null;
  clientNotes: string | null;
}

const paragraphs = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(auto);

export function deliveryNoteDocument(data: DeliveryNoteData): DocumentModel {
  const { locale } = data;
  const t = docLabels(locale);
  const sections: NonNullable<DocumentModel['sections']> = [];
  if (data.equipment) sections.push({ title: t.equipment, items: paragraphs(data.equipment) });
  if (data.serviceNotes) {
    sections.push({ title: t.serviceNotes, items: paragraphs(data.serviceNotes), bullets: false });
  }
  if (data.clientNotes) {
    sections.push({ title: t.clientNotes, items: paragraphs(data.clientNotes), bullets: false });
  }
  sections.push({
    title: t.receptionRemarks,
    items: ['……………………………………………………………………', '……………………………………………………………………'],
    bullets: false,
  });

  return {
    lang: locale,
    title: t.deliveryNote,
    number: data.reference,
    hasLogo: data.hasLogo,
    watermark: null,
    meta: [
      [t.date, localDate(data.date)],
      [t.deliveryTime, ltr(data.deliveryTime)],
      [t.order, ltr(data.reference)],
    ],
    seller: sellerHeader(data.seller),
    parties: [
      {
        title: t.deliverTo,
        lines: [
          auto(joinAddress([data.venue.name, data.venue.address, data.venue.city])),
          `${t.eventTypes[data.eventType]} — ${t.guests(data.guestCount)} — ${ltr(data.startTime)}`,
        ],
      },
      {
        title: t.onSiteContact,
        lines: [auto(data.contact.name), ltr(data.contact.phone)],
      },
    ],
    table: {
      columns: [
        { label: t.description, align: 'start', width: 'fill' },
        { label: t.quantity, align: 'end', width: 'auto' },
      ],
      rows: data.lines.map((line) => [auto(lineLabelText(line.label, locale)), ltr(line.quantity)]),
    },
    sections,
    signature: { title: t.receivedInGoodOrder, hint: t.receiverHint, signedBy: null },
    footer: sellerFooter(data.seller, locale),
  };
}
