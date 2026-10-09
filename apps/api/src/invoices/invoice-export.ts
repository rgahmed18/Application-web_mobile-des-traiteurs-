import { formatTaxRate, type Invoice } from '@traiteur/shared';
import ExcelJS from 'exceljs';

/**
 * Export comptable des factures et avoirs : une ligne par document, montants HT / TVA / TTC et
 * base et TVA par taux. CSV pour Excel en français (UTF-8 avec BOM, séparateur « ; », virgule
 * décimale) ou classeur xlsx (montants numériques, dates réelles).
 */
const KIND_LABELS: Record<Invoice['kind'], string> = {
  TOTAL: 'Facture',
  DEPOSIT: 'Acompte',
  BALANCE: 'Solde',
  CANCELLATION_FEE: "Frais d'annulation",
};

interface Column {
  header: string;
  value: (invoice: Invoice) => string | number | null;
  kind: 'text' | 'date' | 'amount';
  width: number;
}

/** Taux présents dans les documents exportés (colonnes base / TVA par taux). */
function ratesOf(invoices: readonly Invoice[]): number[] {
  return [
    ...new Set(
      invoices.flatMap((invoice) => invoice.taxBreakdown.map((entry) => entry.taxRateBps)),
    ),
  ].sort((a, b) => a - b);
}

function columns(invoices: readonly Invoice[]): Column[] {
  const byRate = (invoice: Invoice, rate: number) =>
    invoice.taxBreakdown.find((entry) => entry.taxRateBps === rate);
  return [
    { header: 'Numéro', value: (i) => i.number, kind: 'text', width: 18 },
    {
      header: 'Type',
      value: (i) => (i.type === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'),
      kind: 'text',
      width: 10,
    },
    { header: 'Nature', value: (i) => KIND_LABELS[i.kind], kind: 'text', width: 18 },
    { header: "Date d'émission", value: (i) => i.issuedOn, kind: 'date', width: 14 },
    { header: 'Échéance', value: (i) => i.dueDate, kind: 'date', width: 14 },
    { header: 'Commande', value: (i) => i.orderReference, kind: 'text', width: 18 },
    { header: 'Client', value: (i) => i.clientName, kind: 'text', width: 28 },
    { header: 'ICE client', value: (i) => i.clientIce, kind: 'text', width: 18 },
    { header: "Facture d'origine", value: (i) => i.originalNumber, kind: 'text', width: 18 },
    { header: 'Total HT', value: (i) => i.totalHt, kind: 'amount', width: 14 },
    { header: 'TVA', value: (i) => i.totalTax, kind: 'amount', width: 14 },
    { header: 'Total TTC', value: (i) => i.totalTtc, kind: 'amount', width: 14 },
    ...ratesOf(invoices).flatMap((rate): Column[] => [
      {
        header: `Base HT ${formatTaxRate(rate)}`,
        value: (i) => byRate(i, rate)?.baseHt ?? 0,
        kind: 'amount',
        width: 14,
      },
      {
        header: `TVA ${formatTaxRate(rate)}`,
        value: (i) => byRate(i, rate)?.taxAmount ?? 0,
        kind: 'amount',
        width: 14,
      },
    ]),
  ];
}

/** 123456 → « 1234,56 » (sans séparateur de milliers : relu comme un nombre par Excel). */
function csvAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')}`;
}

/** « 2026-10-09 » → « 09/10/2026 » */
function csvDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function invoicesCsv(invoices: readonly Invoice[]): Buffer {
  const cols = columns(invoices);
  const lines = [
    cols.map((col) => csvCell(col.header)).join(';'),
    ...invoices.map((invoice) =>
      cols
        .map((col) => {
          const value = col.value(invoice);
          if (value === null) return '';
          if (col.kind === 'amount' && typeof value === 'number') return csvAmount(value);
          if (col.kind === 'date' && typeof value === 'string') return csvDate(value);
          return csvCell(String(value));
        })
        .join(';'),
    ),
  ];
  // BOM : Excel reconnaît l'UTF-8 (accents, noms en arabe)
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function invoicesXlsx(invoices: readonly Invoice[]): Promise<Buffer> {
  const cols = columns(invoices);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestion Traiteurs';
  // Date fixe : le classeur ne dépend que des factures exportées
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const sheet = workbook.addWorksheet('Factures', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = cols.map((col) => ({ header: col.header, width: col.width }));
  sheet.getRow(1).font = { bold: true };
  for (const invoice of invoices) {
    sheet.addRow(
      cols.map((col) => {
        const value = col.value(invoice);
        if (value === null) return null;
        if (col.kind === 'amount' && typeof value === 'number') return value / 100;
        if (col.kind === 'date' && typeof value === 'string') return new Date(`${value}T00:00:00Z`);
        return value;
      }),
    );
  }
  cols.forEach((col, index) => {
    const column = sheet.getColumn(index + 1);
    if (col.kind === 'amount') column.numFmt = '#,##0.00';
    if (col.kind === 'date') column.numFmt = 'dd/mm/yyyy';
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
