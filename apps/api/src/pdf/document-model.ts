/**
 * Modèle d'un document PDF tel que le gabarit Typst le reçoit (assets/templates/document.typ).
 * Tout est déjà formaté et traduit ; les passages ⟦…⟧ sont posés de gauche à droite.
 */
export interface DocumentCell {
  main: string;
  sub?: string | null;
}

export interface DocumentModel {
  lang: 'fr' | 'ar';
  title: string;
  number: string;
  hasLogo: boolean;
  watermark?: string | null;
  /** Lignes d'en-tête à droite : [libellé, valeur]. */
  meta: [string, string][];
  seller: { name: string; lines: string[] };
  /** Blocs encadrés : la première ligne est en gras. */
  parties: { title: string; lines: string[] }[];
  table?: {
    columns: { label: string; align: 'start' | 'center' | 'end'; width: 'auto' | 'fill' }[];
    rows: (string | DocumentCell)[][];
  } | null;
  taxSummary?: {
    title: string;
    columns: [string, string, string];
    rows: [string, string, string][];
  } | null;
  totals?: { label: string; value: string; strong?: boolean }[];
  amountInWords?: string | null;
  sections?: { title: string; items: string[]; bullets?: boolean }[];
  signature?: { title: string; hint: string; signedBy?: string | null } | null;
  footer: string[];
}

/**
 * Passage posé de gauche à droite dans un texte (nombres, dates, références, adresses latines) :
 * isolat bidirectionnel Unicode (LRI … PDI). Contrairement à une boîte, il peut passer à la ligne.
 */
export const ltr = (value: string | number): string => `\u2066${value}\u2069`;

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Texte libre (adresse, nom, libellé) : posé de gauche à droite s'il ne contient aucune lettre
 * arabe — sinon « 12, rue des Orangers » se réordonne mal au milieu d'un document arabe.
 */
export const auto = (value: string): string =>
  value === '' || ARABIC.test(value) ? value : ltr(value);
