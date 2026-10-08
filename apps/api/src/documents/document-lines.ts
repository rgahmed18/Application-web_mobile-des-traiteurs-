/**
 * Lignes des commandes et des devis : SEUL module autorisé à les créer, modifier ou supprimer
 * (règle ESLint « no-restricted-syntax » dans apps/api/eslint.config.mjs).
 *
 * Chaque opération, dans une transaction fournie par l'appelant :
 *   1. verrouille le document (SELECT … FOR UPDATE) : les modifications concurrentes d'un même
 *      document sont sérialisées ;
 *   2. calcule les lignes dans le mode de prix figé du document (packages/shared/src/money) ;
 *   3. écrit les lignes ;
 *   4. recalcule les totaux du document comme somme de ses lignes.
 * La base vérifie en fin de transaction que les totaux égalent la somme des lignes
 * (CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED).
 *
 * Les fonctions prennent un client de transaction : utilisées par DocumentLinesService (API)
 * et par le seed. Les factures, immuables, ne sont pas concernées.
 */
import {
  computeDocumentTotals,
  computeLineAmounts,
  type DocumentTotals,
  type LineAmounts,
  type PriceMode,
} from '@traiteur/shared';

import { appErrors } from '../common/errors';
import type { LineItemType, Prisma } from '../generated/prisma/client';

export type LineDocumentKind = 'ORDER' | 'QUOTE';

/** Document (commande ou devis) dont on modifie les lignes. traiteurId vient du jeton. */
export interface DocumentRef {
  kind: LineDocumentKind;
  id: string;
  traiteurId: string;
}

/**
 * Saisie d'une ligne. `unitPrice` et `discount` sont exprimés dans le mode de prix du
 * document (TTC ou HT) : c'est ce montant qui fait foi.
 */
export interface LineDraft {
  itemType: LineItemType;
  label: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRateBps: number;
  dishId?: string | null;
  packageId?: string | null;
  extraServiceId?: string | null;
  sortOrder?: number;
  /** Commandes uniquement (les lignes de devis n'ont pas de note). */
  notes?: string | null;
}

export interface DocumentLinesResult {
  priceMode: PriceMode;
  totals: DocumentTotals;
}

type Tx = Prisma.TransactionClient;

/** Montants d'une saisie dans le mode du document. */
export function computeDraftAmounts(priceMode: PriceMode, draft: LineDraft): LineAmounts {
  const { quantity, taxRateBps, unitPrice, discount = 0 } = draft;
  return computeLineAmounts(
    priceMode === 'TTC'
      ? { priceMode, unitPriceTtc: unitPrice, discountTtc: discount, quantity, taxRateBps }
      : { priceMode, unitPriceHt: unitPrice, discountHt: discount, quantity, taxRateBps },
  );
}

function toColumns(doc: DocumentRef, priceMode: PriceMode, draft: LineDraft, index: number) {
  const amounts = computeDraftAmounts(priceMode, draft);
  return {
    traiteurId: doc.traiteurId,
    priceMode,
    itemType: draft.itemType,
    label: draft.label,
    quantity: amounts.quantity,
    unitPriceHt: amounts.unitPriceHt,
    unitPriceTtc: amounts.unitPriceTtc,
    discountHt: amounts.discountHt,
    discountTtc: amounts.discountTtc,
    taxRateBps: amounts.taxRateBps,
    totalHt: amounts.totalHt,
    taxAmount: amounts.taxAmount,
    totalTtc: amounts.totalTtc,
    dishId: draft.dishId ?? null,
    packageId: draft.packageId ?? null,
    extraServiceId: draft.extraServiceId ?? null,
    sortOrder: draft.sortOrder ?? index,
  };
}

/** Verrouille le document jusqu'à la fin de la transaction et retourne son mode de prix. */
async function lockDocument(tx: Tx, doc: DocumentRef): Promise<PriceMode> {
  const rows =
    doc.kind === 'ORDER'
      ? await tx.$queryRaw<{ priceMode: PriceMode }[]>`
          SELECT "priceMode"::text AS "priceMode" FROM "Order"
          WHERE "id" = ${doc.id}::uuid AND "traiteurId" = ${doc.traiteurId}::uuid
          FOR UPDATE`
      : await tx.$queryRaw<{ priceMode: PriceMode }[]>`
          SELECT "priceMode"::text AS "priceMode" FROM "Quote"
          WHERE "id" = ${doc.id}::uuid AND "traiteurId" = ${doc.traiteurId}::uuid
          FOR UPDATE`;
  const priceMode = rows[0]?.priceMode;
  if (!priceMode) throw appErrors.notFound('DOCUMENT_NOT_FOUND', 'Document introuvable');
  return priceMode;
}

/** Totaux = somme des lignes en base, écrits sur le document. */
async function recomputeTotals(
  tx: Tx,
  doc: DocumentRef,
  priceMode: PriceMode,
): Promise<DocumentLinesResult> {
  const select = { totalHt: true, taxAmount: true, totalTtc: true, taxRateBps: true } as const;
  const lines =
    doc.kind === 'ORDER'
      ? await tx.orderItem.findMany({
          where: { orderId: doc.id, traiteurId: doc.traiteurId },
          select,
        })
      : await tx.quoteLine.findMany({
          where: { quoteId: doc.id, traiteurId: doc.traiteurId },
          select,
        });
  const totals = computeDocumentTotals(lines);
  const data = { totalHt: totals.totalHt, totalTax: totals.totalTax, totalTtc: totals.totalTtc };
  const where = { id_traiteurId: { id: doc.id, traiteurId: doc.traiteurId } };

  if (doc.kind === 'ORDER') await tx.order.update({ where, data });
  else await tx.quote.update({ where, data });
  return { priceMode, totals };
}

/** Ajoute des lignes au document et met ses totaux à jour. */
export async function addDocumentLines(
  tx: Tx,
  doc: DocumentRef,
  drafts: readonly LineDraft[],
): Promise<DocumentLinesResult> {
  const priceMode = await lockDocument(tx, doc);
  const offset =
    doc.kind === 'ORDER'
      ? await tx.orderItem.count({ where: { orderId: doc.id, traiteurId: doc.traiteurId } })
      : await tx.quoteLine.count({ where: { quoteId: doc.id, traiteurId: doc.traiteurId } });

  if (drafts.length > 0) {
    if (doc.kind === 'ORDER') {
      await tx.orderItem.createMany({
        data: drafts.map((draft, index) => ({
          ...toColumns(doc, priceMode, draft, offset + index),
          orderId: doc.id,
          notes: draft.notes ?? null,
        })),
      });
    } else {
      await tx.quoteLine.createMany({
        data: drafts.map((draft, index) => ({
          ...toColumns(doc, priceMode, draft, offset + index),
          quoteId: doc.id,
        })),
      });
    }
  }
  return recomputeTotals(tx, doc, priceMode);
}

/** Remplace entièrement une ligne (nouvelle saisie) et met les totaux à jour. */
export async function updateDocumentLine(
  tx: Tx,
  doc: DocumentRef,
  lineId: string,
  draft: LineDraft,
): Promise<DocumentLinesResult> {
  const priceMode = await lockDocument(tx, doc);
  const columns = toColumns(doc, priceMode, draft, draft.sortOrder ?? 0);
  const { count } =
    doc.kind === 'ORDER'
      ? await tx.orderItem.updateMany({
          where: { id: lineId, orderId: doc.id, traiteurId: doc.traiteurId },
          data: { ...columns, notes: draft.notes ?? null },
        })
      : await tx.quoteLine.updateMany({
          where: { id: lineId, quoteId: doc.id, traiteurId: doc.traiteurId },
          data: columns,
        });
  if (count === 0) throw appErrors.notFound('LINE_NOT_FOUND', 'Ligne introuvable');
  return recomputeTotals(tx, doc, priceMode);
}

/** Supprime une ligne et met les totaux à jour. */
export async function removeDocumentLine(
  tx: Tx,
  doc: DocumentRef,
  lineId: string,
): Promise<DocumentLinesResult> {
  const priceMode = await lockDocument(tx, doc);
  const { count } =
    doc.kind === 'ORDER'
      ? await tx.orderItem.deleteMany({
          where: { id: lineId, orderId: doc.id, traiteurId: doc.traiteurId },
        })
      : await tx.quoteLine.deleteMany({
          where: { id: lineId, quoteId: doc.id, traiteurId: doc.traiteurId },
        });
  if (count === 0) throw appErrors.notFound('LINE_NOT_FOUND', 'Ligne introuvable');
  return recomputeTotals(tx, doc, priceMode);
}

/** Remplace toutes les lignes du document (ex. copie d'une commande vers un devis). */
export async function replaceDocumentLines(
  tx: Tx,
  doc: DocumentRef,
  drafts: readonly LineDraft[],
): Promise<DocumentLinesResult> {
  await lockDocument(tx, doc);
  if (doc.kind === 'ORDER') {
    await tx.orderItem.deleteMany({ where: { orderId: doc.id, traiteurId: doc.traiteurId } });
  } else {
    await tx.quoteLine.deleteMany({ where: { quoteId: doc.id, traiteurId: doc.traiteurId } });
  }
  return addDocumentLines(tx, doc, drafts);
}
