import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PdfRenderPool } from '../../src/pdf/pdf-render-pool';
import { ASSETS_DIR } from '../../src/pdf/pdf.service';
import type { Seller } from '../../src/pdf/seller';
import { quoteDocument } from '../../src/quotes/quote-document';

/** Passage isolé de gauche à droite (LRI … PDI) : le moteur bidi de Typst le garde dans l'ordre. */
const LTR_RUN = /\u2066([^\u2066-\u2069]*)\u2069/g;

const seller = {
  name: 'Dar Diafa Traiteur',
  email: 'contact@exemple.ma',
  phone: '+212522000000',
  city: 'Casablanca',
  legalName: null,
  legalForm: null,
  shareCapital: null,
  ice: null,
  rcNumber: null,
  rcCourt: null,
  taxId: null,
  patenteNumber: null,
  cnssNumber: null,
  legalAddress: null,
  bankName: null,
  rib: null,
  invoiceFooter: null,
  isVatRegistered: true,
  timezone: 'Africa/Casablanca',
  logoKey: null,
} as unknown as Seller;

/** Devis arabe de 163 500,00 MAD TTC (une ligne), acompte de 42 000,00 MAD. */
function arabicQuote() {
  return quoteDocument({
    locale: 'ar',
    seller,
    hasLogo: false,
    reference: 'DEV-2026-0042',
    version: 1,
    status: 'SENT',
    validUntil: '2026-12-31',
    priceMode: 'TTC',
    notes: null,
    snapshot: {
      v: 1,
      issuedOn: '2026-11-19',
      orderReference: 'CMD-2026-0042',
      seller: { name: seller.name, phone: seller.phone, email: seller.email },
      client: { name: 'كريم العلوي', phone: '+212661234567', email: null },
      event: {
        type: 'WEDDING',
        typeName: { fr: 'Mariage', ar: 'عرس' },
        date: '2027-06-12',
        startTime: '19:00',
        endTime: '02:00',
        endsNextDay: true,
        guestCount: 150,
        venueName: null,
        venueAddress: '8, avenue Hassan II',
        city: 'Casablanca',
      },
      terms: { fr: null, ar: null },
      schedule: [
        { kind: 'DEPOSIT', amount: 4_200_000, dueDate: null },
        { kind: 'BALANCE', amount: 12_150_000, dueDate: '2027-06-05' },
      ],
    },
    lines: [
      {
        label: { fr: 'Formule Mariage Premium', ar: 'عرض العرس الممتاز' },
        quantity: 150,
        unitPriceHt: 90_833,
        unitPriceTtc: 109_000,
        discountHt: 0,
        discountTtc: 0,
        taxRateBps: 2000,
        totalHt: 13_625_000,
        taxAmount: 2_725_000,
        totalTtc: 16_350_000,
      },
    ],
    acceptance: null,
  });
}

describe('PDF en arabe : montants dans l’ordre de lecture', () => {
  it('chaque montant est un passage gauche-droite du gabarit ; « د.م. » reste après le montant', () => {
    const model = JSON.stringify(arabicQuote());
    const runs = [...model.matchAll(LTR_RUN)].map((match) => match[1]);
    // Séparateur des milliers : espace insécable fine (U+202F)
    expect(runs).toContain('163\u202f500,00');
    expect(runs).toContain('42\u202f000,00');
    expect(runs).toContain('1\u202f090,00');
    // Jamais un nombre à milliers hors passage gauche-droite
    expect(model.replace(LTR_RUN, '')).not.toMatch(/\d[\u00a0\u202f ]\d{3}/);
    // Montant isolé, puis la devise isolée de droite à gauche (« د.م. » après le montant)
    expect(model).toContain('\u2066163\u202f500,00\u2069\u00a0\u2067د.م.\u2069');
  });

  it('rendu Typst : PDF produit (enregistré dans PDF_DEBUG_DIR pour contrôle visuel)', async () => {
    const pool = new PdfRenderPool({
      assetsDir: ASSETS_DIR,
      template: readFileSync(join(ASSETS_DIR, 'templates', 'document.typ'), 'utf8'),
      size: 1,
      timeoutMs: 60_000,
      log: () => undefined,
    });
    try {
      const rendered = await pool.render(arabicQuote(), null);
      const bytes = rendered.pdf;
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const dir = process.env.PDF_DEBUG_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'devis-arabe.pdf'), bytes);
      }
    } finally {
      await pool.close();
    }
  });
});
