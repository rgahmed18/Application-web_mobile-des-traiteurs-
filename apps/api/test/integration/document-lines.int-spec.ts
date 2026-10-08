import { randomUUID } from 'node:crypto';

import { getErrorCode } from '../../src/common/errors';
import type { DocumentRef, LineDraft } from '../../src/documents/document-lines';
import { DocumentLinesService } from '../../src/documents/document-lines.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createOrder, createTenant, createTestPrisma, type TestTenant } from './helpers';

const draft = (overrides: Partial<LineDraft> = {}): LineDraft => ({
  itemType: 'CUSTOM',
  label: 'Ligne',
  quantity: 1,
  unitPrice: 10_000,
  taxRateBps: 2000,
  ...overrides,
});

async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return getErrorCode(error);
  }
  return undefined;
}

describe('DocumentLinesService (base réelle)', () => {
  let prisma: PrismaClient;
  let service: DocumentLinesService;

  beforeAll(() => {
    prisma = createTestPrisma();
    service = new DocumentLinesService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function orderRef(tenant: TestTenant, priceMode: 'HT' | 'TTC' = 'TTC') {
    const order = await createOrder(prisma, tenant, { priceMode });
    return { kind: 'ORDER', id: order.id, traiteurId: tenant.traiteurId } satisfies DocumentRef;
  }

  async function storedTotals(ref: DocumentRef) {
    const lines = await prisma.orderItem.findMany({ where: { orderId: ref.id } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ref.id } });
    return {
      order: { totalHt: order.totalHt, totalTax: order.totalTax, totalTtc: order.totalTtc },
      sumOfLines: {
        totalHt: lines.reduce((sum, line) => sum + line.totalHt, 0),
        totalTax: lines.reduce((sum, line) => sum + line.taxAmount, 0),
        totalTtc: lines.reduce((sum, line) => sum + line.totalTtc, 0),
      },
      count: lines.length,
    };
  }

  it('ajoute des lignes en mode TTC : 250 MAD × 120 = 30 000,00 MAD exactement', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    const result = await service.addLines(ref, [
      draft({ itemType: 'PACKAGE', label: 'Formule', quantity: 120, unitPrice: 25_000 }),
      draft({ label: 'Jus', quantity: 120, unitPrice: 1_500, taxRateBps: 1000 }),
    ]);

    expect(result.priceMode).toBe('TTC');
    expect(result.totals.totalTtc).toBe(3_180_000);
    expect(result.totals.taxBreakdown).toEqual([
      { taxRateBps: 1000, baseHt: 163_636, taxAmount: 16_364 },
      { taxRateBps: 2000, baseHt: 2_500_000, taxAmount: 500_000 },
    ]);
    const stored = await storedTotals(ref);
    expect(stored.order).toEqual(stored.sumOfLines);
  });

  it('met les totaux à jour après modification et suppression d’une ligne', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    await service.addLines(ref, [draft({ label: 'A' }), draft({ label: 'B', unitPrice: 5_000 })]);
    const [first, second] = await prisma.orderItem.findMany({
      where: { orderId: ref.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (!first || !second) throw new Error('lignes attendues');

    const updated = await service.updateLine(
      ref,
      first.id,
      draft({ label: 'A', quantity: 3, discount: 1_000 }),
    );
    expect(updated.totals.totalTtc).toBe(3 * 10_000 - 1_000 + 5_000);

    const removed = await service.removeLine(ref, second.id);
    expect(removed.totals.totalTtc).toBe(29_000);
    const stored = await storedTotals(ref);
    expect(stored.count).toBe(1);
    expect(stored.order).toEqual(stored.sumOfLines);
  });

  it('remplace toutes les lignes d’un document', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    await service.addLines(ref, [draft(), draft(), draft()]);
    const result = await service.replaceLines(ref, [draft({ unitPrice: 4_200 })]);
    expect(result.totals.totalTtc).toBe(4_200);
    expect((await storedTotals(ref)).count).toBe(1);
  });

  it('sérialise 20 ajouts simultanés sur la même commande : totaux toujours exacts', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.addLines(ref, [draft({ label: `L${index}`, unitPrice: 1_000 + index })]),
      ),
    );
    const stored = await storedTotals(ref);
    expect(stored.count).toBe(20);
    expect(stored.order).toEqual(stored.sumOfLines);
    expect(stored.order.totalTtc).toBe(20 * 1_000 + (19 * 20) / 2);
  });

  it('calcule les lignes d’un devis en mode HT', async () => {
    const tenant = await createTenant(prisma);
    const order = await createOrder(prisma, tenant, { priceMode: 'HT' });
    const quote = await prisma.quote.create({
      data: {
        traiteurId: tenant.traiteurId,
        orderId: order.id,
        reference: `DEV-${randomUUID().slice(0, 8)}`,
        priceMode: 'HT',
      },
    });
    const ref: DocumentRef = { kind: 'QUOTE', id: quote.id, traiteurId: tenant.traiteurId };
    const result = await service.addLines(ref, [draft({ unitPrice: 33, quantity: 3 })]);
    expect(result.totals).toMatchObject({ totalHt: 99, totalTax: 20, totalTtc: 119 });
    const lines = await prisma.quoteLine.findMany({ where: { quoteId: quote.id } });
    expect(lines[0]?.priceMode).toBe('HT');
  });

  it('refuse un document d’un autre traiteur (traiteurId issu du jeton)', async () => {
    const a = await createTenant(prisma);
    const b = await createTenant(prisma);
    const refOfA = await orderRef(a);
    const forged: DocumentRef = { ...refOfA, traiteurId: b.traiteurId };
    expect(await errorCodeOf(service.addLines(forged, [draft()]))).toBe('DOCUMENT_NOT_FOUND');
  });

  it('refuse de modifier une ligne qui appartient à un autre document', async () => {
    const tenant = await createTenant(prisma);
    const refA = await orderRef(tenant);
    const refB = await orderRef(tenant);
    await service.addLines(refA, [draft()]);
    const [lineOfA] = await prisma.orderItem.findMany({ where: { orderId: refA.id } });
    if (!lineOfA) throw new Error('ligne attendue');
    expect(await errorCodeOf(service.removeLine(refB, lineOfA.id))).toBe('LINE_NOT_FOUND');
    expect((await storedTotals(refA)).count).toBe(1);
  });

  it('annule toute l’opération si une ligne est invalide (aucune écriture partielle)', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    await expect(
      service.addLines(ref, [draft(), draft({ quantity: 1, discount: 20_000 })]),
    ).rejects.toThrow(RangeError);
    const stored = await storedTotals(ref);
    expect(stored.count).toBe(0);
    expect(stored.order.totalTtc).toBe(0);
  });

  it('s’inscrit dans une transaction plus large fournie par l’appelant', async () => {
    const tenant = await createTenant(prisma);
    const ref = await orderRef(tenant);
    await expect(
      prisma.$transaction(async (tx) => {
        await service.addLines(ref, [draft()], tx);
        throw new Error('échec après ajout des lignes');
      }),
    ).rejects.toThrow('échec après ajout');
    expect((await storedTotals(ref)).count).toBe(0);
  });
});
