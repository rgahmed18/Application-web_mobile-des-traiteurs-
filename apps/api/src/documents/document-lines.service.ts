import { Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDocumentLines,
  type DocumentLinesResult,
  type DocumentRef,
  type LineDraft,
  removeDocumentLine,
  replaceDocumentLines,
  updateDocumentLine,
} from './document-lines';

/**
 * Service de domaine des lignes de commande et de devis : le SEUL point d'entrée pour les
 * ajouter, modifier ou supprimer. Il recalcule les totaux et écrit le tout dans une même
 * transaction. Aucun autre service ne doit écrire dans OrderItem ou QuoteLine (règle ESLint).
 *
 * `tx` facultatif : passer la transaction en cours pour inclure l'opération dans un traitement
 * plus large (ex. création d'une commande avec ses lignes) ; sinon une transaction est ouverte.
 */
@Injectable()
export class DocumentLinesService {
  constructor(private readonly prisma: PrismaService) {}

  addLines(
    doc: DocumentRef,
    drafts: readonly LineDraft[],
    tx?: Prisma.TransactionClient,
  ): Promise<DocumentLinesResult> {
    return this.run(tx, (client) => addDocumentLines(client, doc, drafts));
  }

  updateLine(
    doc: DocumentRef,
    lineId: string,
    draft: LineDraft,
    tx?: Prisma.TransactionClient,
  ): Promise<DocumentLinesResult> {
    return this.run(tx, (client) => updateDocumentLine(client, doc, lineId, draft));
  }

  removeLine(
    doc: DocumentRef,
    lineId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DocumentLinesResult> {
    return this.run(tx, (client) => removeDocumentLine(client, doc, lineId));
  }

  replaceLines(
    doc: DocumentRef,
    drafts: readonly LineDraft[],
    tx?: Prisma.TransactionClient,
  ): Promise<DocumentLinesResult> {
    return this.run(tx, (client) => replaceDocumentLines(client, doc, drafts));
  }

  private run<T>(
    tx: Prisma.TransactionClient | undefined,
    operation: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx ? operation(tx) : this.prisma.$transaction(operation);
  }
}
