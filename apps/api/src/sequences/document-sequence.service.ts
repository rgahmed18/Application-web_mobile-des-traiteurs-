import { Injectable } from '@nestjs/common';

import type { DocumentType, Prisma } from '../generated/prisma/client';
import { nextDocumentNumber, type NextDocumentNumber } from './document-sequence';

/**
 * Générateur de références de documents (CMD-, DEV-, FAC-, AV-).
 *
 * Usage :
 *   await prisma.$transaction(async (tx) => {
 *     const { reference } = await sequences.next(tx, { traiteurId, type: 'INVOICE' });
 *     await tx.invoice.create({ data: { number: reference, ... } });
 *   });
 */
@Injectable()
export class DocumentSequenceService {
  next(
    tx: Prisma.TransactionClient,
    params: { traiteurId: string; type: DocumentType; date?: Date; timeZone?: string },
  ): Promise<NextDocumentNumber> {
    return nextDocumentNumber(tx, params);
  }
}
