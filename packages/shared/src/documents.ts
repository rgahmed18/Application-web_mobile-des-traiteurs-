import { z } from 'zod';

export const DOCUMENT_TYPES = ['ORDER', 'QUOTE', 'INVOICE', 'CREDIT_NOTE'] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;

/** Préfixes des références : CMD-2026-00001, DEV-…, FAC-…, AV-… */
export const DOCUMENT_PREFIXES: Readonly<Record<DocumentType, string>> = {
  ORDER: 'CMD',
  QUOTE: 'DEV',
  INVOICE: 'FAC',
  CREDIT_NOTE: 'AV',
};

const SEQUENCE_PADDING = 5;

/** Construit la référence lisible d'un document à partir de son numéro de séquence. */
export function formatDocumentReference(type: DocumentType, year: number, value: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(value) || value < 1) {
    throw new RangeError('year et value doivent être des entiers, value ≥ 1');
  }
  return `${DOCUMENT_PREFIXES[type]}-${year}-${String(value).padStart(SEQUENCE_PADDING, '0')}`;
}
