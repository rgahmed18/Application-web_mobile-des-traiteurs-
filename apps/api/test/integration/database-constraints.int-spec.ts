import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { buildInvoiceAmounts, createOrder, createTenant, createTestPrisma } from './helpers';

const SELLER = { legalName: 'Dar Diafa SARL', ice: '001234567000089' };
const BUYER = { name: 'Client Test', phone: '+212612345678' };

describe('Contraintes de la base de données', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createInvoice(
    traiteurId: string,
    orderId: string,
    overrides: { type?: 'INVOICE' | 'CREDIT_NOTE'; originalInvoiceId?: string; sign?: 1 | -1 } = {},
  ) {
    const { lines, totals } = buildInvoiceAmounts(overrides.sign ?? 1);
    return prisma.invoice.create({
      data: {
        traiteurId,
        orderId,
        type: overrides.type ?? 'INVOICE',
        originalInvoiceId: overrides.originalInvoiceId ?? null,
        number: `FAC-TEST-${randomUUID().slice(0, 8)}`,
        year: 2026,
        sequenceNumber: Math.floor(Math.random() * 1_000_000) + 1,
        ...totals,
        sellerSnapshot: SELLER,
        buyerSnapshot: BUYER,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  describe('isolation multi-tenant (clés composites)', () => {
    it('refuse une commande du traiteur A rattachée à un client du traiteur B', async () => {
      const a = await createTenant(prisma);
      const b = await createTenant(prisma);
      await expect(
        createOrder(prisma, { traiteurId: a.traiteurId, clientMembershipId: b.clientMembershipId }),
      ).rejects.toThrow();
    });

    it('refuse une ligne de commande pointant vers un plat d’un autre traiteur', async () => {
      const a = await createTenant(prisma);
      const b = await createTenant(prisma);
      const order = await createOrder(prisma, a);
      const foreignDish = await prisma.dish.create({
        data: { traiteurId: b.traiteurId, slug: 'plat', name: { fr: 'Plat' }, priceHt: 1000 },
      });
      await expect(
        prisma.orderItem.create({
          data: {
            traiteurId: a.traiteurId,
            orderId: order.id,
            itemType: 'DISH',
            dishId: foreignDish.id,
            label: 'Plat',
            quantity: 1,
            unitPriceHt: 1000,
            taxRateBps: 2000,
            totalHt: 1000,
            taxAmount: 200,
            totalTtc: 1200,
          },
        }),
      ).rejects.toThrow();
    });

    it('ON DELETE SET NULL ("dishId") vide la référence sans toucher au traiteurId', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const dish = await prisma.dish.create({
        data: {
          traiteurId: tenant.traiteurId,
          slug: 'tajine',
          name: { fr: 'Tajine' },
          priceHt: 5000,
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          traiteurId: tenant.traiteurId,
          orderId: order.id,
          itemType: 'DISH',
          dishId: dish.id,
          label: 'Tajine',
          quantity: 2,
          unitPriceHt: 5000,
          taxRateBps: 2000,
          totalHt: 10_000,
          taxAmount: 2_000,
          totalTtc: 12_000,
        },
      });

      await prisma.dish.delete({ where: { id: dish.id } });

      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.dishId).toBeNull();
      expect(after.traiteurId).toBe(tenant.traiteurId);
      expect(after.label).toBe('Tajine');
    });
  });

  describe('contraintes CHECK et unicité', () => {
    it('interdit un Membership avec le rôle SUPER_ADMIN', async () => {
      const tenant = await createTenant(prisma);
      const user = await prisma.user.create({
        data: { phone: `+2127${Date.now().toString().slice(-8)}`, firstName: 'A', lastName: 'B' },
      });
      await expect(
        prisma.membership.create({
          data: { traiteurId: tenant.traiteurId, userId: user.id, role: 'SUPER_ADMIN' },
        }),
      ).rejects.toThrow();
    });

    it('interdit deux lignes identiques dans la matrice par défaut (NULLS NOT DISTINCT)', async () => {
      const permission = await prisma.permission.create({
        data: { key: `test.${randomUUID()}`, module: 'test', description: 'Test' },
      });
      await prisma.rolePermission.create({
        data: { traiteurId: null, role: 'EMPLOYE', permissionId: permission.id },
      });
      await expect(
        prisma.rolePermission.create({
          data: { traiteurId: null, role: 'EMPLOYE', permissionId: permission.id },
        }),
      ).rejects.toThrow();
    });

    it('refuse une ligne dont les montants sont incohérents', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      await expect(
        prisma.orderItem.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            itemType: 'CUSTOM',
            label: 'Erreur',
            quantity: 2,
            unitPriceHt: 1000,
            taxRateBps: 2000,
            totalHt: 2000,
            taxAmount: 400,
            totalTtc: 2500, // devrait être 2400
          },
        }),
      ).rejects.toThrow();
    });

    it('refuse une note d’avis hors de 1 à 5', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      await expect(
        prisma.review.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            clientId: tenant.clientMembershipId,
            rating: 6,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('factures et avoirs', () => {
    it('crée une facture cohérente, puis refuse toute modification ou suppression', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);
      expect(invoice.lines).toHaveLength(2);

      await expect(
        prisma.invoice.update({ where: { id: invoice.id }, data: { totalHt: 1 } }),
      ).rejects.toThrow(/immuable/);
      await expect(
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { buyerSnapshot: { name: 'Autre' } },
        }),
      ).rejects.toThrow(/immuable/);
      await expect(prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(
        /immuable/,
      );
      await expect(
        prisma.invoiceLine.update({ where: { id: invoice.lines[0]?.id }, data: { label: 'X' } }),
      ).rejects.toThrow(/immuable/);
    });

    it('autorise uniquement l’ajout du PDF', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { pdfUrl: 'https://cdn.exemple.ma/fac.pdf' },
      });
      expect(updated.pdfUrl).toBe('https://cdn.exemple.ma/fac.pdf');
    });

    it('refuse d’ajouter une ligne à une facture déjà émise', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);
      await expect(
        prisma.invoiceLine.create({
          data: {
            traiteurId: tenant.traiteurId,
            invoiceId: invoice.id,
            itemType: 'CUSTOM',
            label: 'Ajout frauduleux',
            quantity: 1,
            unitPriceHt: 1000,
            taxRateBps: 2000,
            totalHt: 1000,
            taxAmount: 200,
            totalTtc: 1200,
          },
        }),
      ).rejects.toThrow(/incohérents/);
    });

    it('refuse une facture dont les totaux ne correspondent pas aux lignes', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const { lines, totals } = buildInvoiceAmounts();
      await expect(
        prisma.invoice.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            number: `FAC-TEST-${randomUUID().slice(0, 8)}`,
            year: 2026,
            sequenceNumber: 1,
            totalHt: totals.totalHt + 100,
            totalTax: totals.totalTax,
            totalTtc: totals.totalTtc + 100,
            sellerSnapshot: SELLER,
            buyerSnapshot: BUYER,
            lines: { create: lines },
          },
        }),
      ).rejects.toThrow(/incohérents/);
    });

    it('accepte un avoir négatif référençant la facture, refuse un avoir sans référence', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);

      const creditNote = await createInvoice(tenant.traiteurId, order.id, {
        type: 'CREDIT_NOTE',
        originalInvoiceId: invoice.id,
        sign: -1,
      });
      expect(creditNote.totalTtc).toBe(-invoice.totalTtc);

      await expect(
        createInvoice(tenant.traiteurId, order.id, { type: 'CREDIT_NOTE', sign: -1 }),
      ).rejects.toThrow();
      // Un avoir ne peut pas référencer un autre avoir
      await expect(
        createInvoice(tenant.traiteurId, order.id, {
          type: 'CREDIT_NOTE',
          originalInvoiceId: creditNote.id,
          sign: -1,
        }),
      ).rejects.toThrow(/référence doit être une facture/);
    });
  });
});
