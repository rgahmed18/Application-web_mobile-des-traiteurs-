/**
 * Fichier volontairement fautif : il vérifie que la règle ESLint qui réserve l'écriture des
 * lignes à DocumentLinesService détecte bien chaque contournement.
 * Exclu du lint normal ; analysé par src/documents/document-lines.lint.spec.ts.
 */
import type { PrismaService } from '../../src/prisma/prisma.service';

declare const prisma: PrismaService;

export async function forbiddenWrites(orderId: string, quoteId: string): Promise<void> {
  await prisma.orderItem.deleteMany({ where: { orderId } }); // interdit
  await prisma.quoteLine.updateMany({ where: { quoteId }, data: { label: 'X' } }); // interdit
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.delete({ where: { id: orderId } }); // interdit (via transaction)
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { items: { deleteMany: {} } }, // interdit (écriture imbriquée)
  });
  await prisma.quote.update({
    where: { id: quoteId },
    data: { lines: { deleteMany: {} } }, // interdit (écriture imbriquée)
  });
}

export async function allowedAccess(orderId: string): Promise<number> {
  // Lectures autorisées
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  const lines = await prisma.quoteLine.count();
  // Écrire les lignes d'une facture (immuable, créée en une fois) reste autorisé
  await prisma.invoice.findMany({ include: { lines: true } });
  return items.length + lines;
}
