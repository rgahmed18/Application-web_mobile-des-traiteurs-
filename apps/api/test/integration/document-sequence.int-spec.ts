import type { PrismaClient } from '../../src/generated/prisma/client';
import { nextDocumentNumber } from '../../src/sequences/document-sequence';
import { createOrder, createTenant, createTestPrisma } from './helpers';

describe('Numérotation des documents (DocumentSequence)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('attribue 50 numéros distincts et consécutifs à 50 transactions simultanées', async () => {
    const { traiteurId } = await createTenant(prisma);

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        prisma.$transaction((tx) => nextDocumentNumber(tx, { traiteurId, type: 'INVOICE' })),
      ),
    );

    const values = results.map((r) => r.value).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.reference)).size).toBe(50);
    expect(results.every((r) => /^FAC-\d{4}-\d{5}$/.test(r.reference))).toBe(true);
  });

  it('ne laisse aucun trou quand la transaction qui a réservé un numéro échoue', async () => {
    const { traiteurId } = await createTenant(prisma);

    const first = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, { traiteurId, type: 'QUOTE' }),
    );
    await expect(
      prisma.$transaction(async (tx) => {
        await nextDocumentNumber(tx, { traiteurId, type: 'QUOTE' });
        throw new Error('échec simulé après réservation du numéro');
      }),
    ).rejects.toThrow('échec simulé');
    const next = await prisma.$transaction((tx) =>
      nextDocumentNumber(tx, { traiteurId, type: 'QUOTE' }),
    );

    expect(first.value).toBe(1);
    expect(next.value).toBe(2);
  });

  it('crée 20 commandes en parallèle avec des références uniques et sans trou', async () => {
    const tenant = await createTenant(prisma);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction(async (tx) => {
          const { reference } = await nextDocumentNumber(tx, {
            traiteurId: tenant.traiteurId,
            type: 'ORDER',
          });
          return createOrder(tx as unknown as PrismaClient, tenant, { reference });
        }),
      ),
    );

    const orders = await prisma.order.findMany({
      where: { traiteurId: tenant.traiteurId },
      orderBy: { reference: 'asc' },
    });
    const numbers = orders.map((o) => Number(o.reference.split('-')[2]));
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('sépare les compteurs par traiteur, par type et par année', async () => {
    const a = await createTenant(prisma);
    const b = await createTenant(prisma);
    const next = (traiteurId: string, type: 'ORDER' | 'INVOICE', date?: Date) =>
      prisma.$transaction((tx) => nextDocumentNumber(tx, { traiteurId, type, date }));

    expect((await next(a.traiteurId, 'ORDER')).value).toBe(1);
    expect((await next(a.traiteurId, 'ORDER')).value).toBe(2);
    expect((await next(b.traiteurId, 'ORDER')).value).toBe(1);
    expect((await next(a.traiteurId, 'INVOICE')).value).toBe(1);

    const nextYear = await next(a.traiteurId, 'ORDER', new Date('2031-06-01T12:00:00Z'));
    expect(nextYear).toMatchObject({ year: 2031, value: 1, reference: 'CMD-2031-00001' });
  });
});
