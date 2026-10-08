import { randomUUID } from 'node:crypto';

import { computeDocumentTotals, computeLineAmounts, type PriceMode } from '@traiteur/shared';

import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  buildInvoiceAmounts,
  createOrder,
  createTenant,
  createTestPrisma,
  sampleLines,
  toLineRow,
} from './helpers';

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
    options: {
      type?: 'INVOICE' | 'CREDIT_NOTE';
      originalInvoiceId?: string;
      sign?: 1 | -1;
      priceMode?: PriceMode;
    } = {},
  ) {
    const priceMode = options.priceMode ?? 'TTC';
    const { lines, totals, taxBreakdown } = buildInvoiceAmounts(priceMode, options.sign ?? 1);
    return prisma.invoice.create({
      data: {
        traiteurId,
        orderId,
        type: options.type ?? 'INVOICE',
        originalInvoiceId: options.originalInvoiceId ?? null,
        number: `FAC-TEST-${randomUUID().slice(0, 8)}`,
        year: 2026,
        sequenceNumber: Math.floor(Math.random() * 1_000_000) + 1,
        priceMode,
        ...totals,
        taxBreakdown,
        sellerSnapshot: SELLER,
        buyerSnapshot: BUYER,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }

  async function createDish(traiteurId: string, slug: string) {
    return prisma.dish.create({
      data: { traiteurId, slug, name: { fr: slug }, priceHt: 5_000, priceTtc: 6_000 },
    });
  }

  describe('isolation multi-tenant (clés composites)', () => {
    it('refuse une commande du traiteur A rattachée à un client du traiteur B', async () => {
      const a = await createTenant(prisma);
      const b = await createTenant(prisma);
      await expect(
        createOrder(prisma, { traiteurId: a.traiteurId, clientMembershipId: b.clientMembershipId }),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });

    it('refuse une ligne de commande pointant vers un plat d’un autre traiteur', async () => {
      const a = await createTenant(prisma);
      const b = await createTenant(prisma);
      const order = await createOrder(prisma, a);
      const foreignDish = await createDish(b.traiteurId, 'plat');
      const line = computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 6_000,
        quantity: 1,
        taxRateBps: 2000,
      });
      // La clé (dishId, traiteurId) n'existe pas chez le traiteur A : refus immédiat à l'insertion
      await expect(
        prisma.orderItem.create({
          data: {
            ...toLineRow(line),
            traiteurId: a.traiteurId,
            orderId: order.id,
            priceMode: 'TTC',
            itemType: 'DISH',
            dishId: foreignDish.id,
          },
        }),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });

    it('ON DELETE SET NULL ("dishId") vide la référence sans toucher au traiteurId', async () => {
      const tenant = await createTenant(prisma);
      const dish = await createDish(tenant.traiteurId, 'tajine');
      const line = computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 6_000,
        quantity: 2,
        taxRateBps: 2000,
      });
      const order = await prisma.order.create({
        data: {
          traiteurId: tenant.traiteurId,
          clientId: tenant.clientMembershipId,
          reference: `CMD-${randomUUID().slice(0, 8)}`,
          priceMode: 'TTC',
          eventType: 'WEDDING',
          eventDate: new Date('2026-12-12T18:00:00Z'),
          guestCount: 2,
          venueAddress: 'Salle',
          city: 'Rabat',
          totalHt: line.totalHt,
          totalTax: line.taxAmount,
          totalTtc: line.totalTtc,
          items: { create: { ...toLineRow(line), itemType: 'DISH', dishId: dish.id } },
        },
        include: { items: true },
      });

      await prisma.dish.delete({ where: { id: dish.id } });

      const item = await prisma.orderItem.findUniqueOrThrow({
        where: { id: order.items[0]?.id },
      });
      expect(item.dishId).toBeNull();
      expect(item.traiteurId).toBe(tenant.traiteurId);
    });
  });

  describe('mode de prix et calcul des lignes', () => {
    it('enregistre exactement 250 MAD TTC × 120 = 30 000,00 MAD en mode TTC', async () => {
      const tenant = await createTenant(prisma);
      const line = computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 25_000,
        quantity: 120,
        taxRateBps: 2000,
      });
      const order = await prisma.order.create({
        data: {
          traiteurId: tenant.traiteurId,
          clientId: tenant.clientMembershipId,
          reference: `CMD-${randomUUID().slice(0, 8)}`,
          priceMode: 'TTC',
          eventType: 'ENGAGEMENT',
          eventDate: new Date('2026-11-21T18:00:00Z'),
          guestCount: 120,
          venueAddress: 'Salle',
          city: 'Casablanca',
          totalHt: line.totalHt,
          totalTax: line.taxAmount,
          totalTtc: line.totalTtc,
          items: { create: toLineRow(line) },
        },
        include: { items: true },
      });
      expect(order.totalTtc).toBe(3_000_000);
      expect(order.items[0]?.priceMode).toBe('TTC'); // recopié depuis la commande
    });

    it.each([
      ['TTC : HT décalé d’un centime', { totalHt: 2_500_001, taxAmount: 499_999 }],
      [
        'TTC : TTC différent de PU × quantité',
        { totalHt: 2_500_000, taxAmount: 500_100, totalTtc: 3_000_100 },
      ],
    ])('refuse une ligne incohérente (%s)', async (_label, override) => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const line = computeLineAmounts({
        priceMode: 'TTC',
        unitPriceTtc: 25_000,
        quantity: 120,
        taxRateBps: 2000,
      });
      await expect(
        prisma.orderItem.create({
          data: {
            ...toLineRow(line),
            ...override,
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            priceMode: 'TTC',
          },
        }),
      ).rejects.toThrow(/OrderItem_amounts_check/);
    });

    it('refuse une ligne HT dont la TVA n’est pas l’arrondi de HT × taux', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant, { priceMode: 'HT' });
      const line = computeLineAmounts({
        priceMode: 'HT',
        unitPriceHt: 33,
        quantity: 3,
        taxRateBps: 2000,
      });
      await expect(
        prisma.orderItem.create({
          data: {
            ...toLineRow(line),
            taxAmount: 21, // 3 × 0,07 au lieu de arrondi(0,99 × 20 %) = 0,20
            totalTtc: 120,
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            priceMode: 'HT',
          },
        }),
      ).rejects.toThrow(/OrderItem_amounts_check/);
    });

    it('refuse une ligne dont le mode diffère de celui de son document', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant, { priceMode: 'TTC' });
      const line = computeLineAmounts({
        priceMode: 'HT',
        unitPriceHt: 1_000,
        quantity: 1,
        taxRateBps: 2000,
      });
      await expect(
        prisma.orderItem.create({
          data: {
            ...toLineRow(line),
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            priceMode: 'HT',
          },
        }),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });

    it('fige le mode de prix d’une commande après sa création', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant, { priceMode: 'TTC' });
      await expect(
        prisma.order.update({ where: { id: order.id }, data: { priceMode: 'HT' } }),
      ).rejects.toThrow(/figé/);
    });
  });

  describe('totaux des commandes et devis = somme des lignes', () => {
    it('accepte l’ajout d’une ligne si les totaux sont mis à jour dans la même transaction', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const lines = sampleLines('TTC');
      const totals = computeDocumentTotals(lines);
      await prisma.$transaction(async (tx) => {
        await tx.orderItem.createMany({
          data: lines.map((line, index) => ({
            ...toLineRow(line, index),
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            priceMode: 'TTC' as const,
          })),
        });
        await tx.order.update({
          where: { id: order.id },
          data: { totalHt: totals.totalHt, totalTax: totals.totalTax, totalTtc: totals.totalTtc },
        });
      });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.totalTtc).toBe(totals.totalTtc);
    });

    it('refuse une ligne ajoutée sans mise à jour des totaux', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const [line] = sampleLines('TTC');
      if (!line) throw new Error('ligne attendue');
      await expect(
        prisma.orderItem.create({
          data: {
            ...toLineRow(line),
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            priceMode: 'TTC',
          },
        }),
      ).rejects.toThrow(/totaux incohérents/);
    });

    it('refuse un devis dont le total a été recalculé autrement que par la somme des lignes', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const lines = sampleLines('TTC');
      const totals = computeDocumentTotals(lines);
      await expect(
        prisma.quote.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            reference: `DEV-${randomUUID().slice(0, 8)}`,
            priceMode: 'TTC',
            totalHt: totals.totalHt + 1,
            totalTax: totals.totalTax - 1,
            totalTtc: totals.totalTtc,
            lines: { create: lines.map(toLineRow) },
          },
        }),
      ).rejects.toThrow(/totaux incohérents/);
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
      ).rejects.toThrow(/Membership_role_not_super_admin_check/);
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
      ).rejects.toThrow(/Unique constraint/);
    });

    it('refuse un prix de catalogue TTC inférieur au HT', async () => {
      const tenant = await createTenant(prisma);
      await expect(
        prisma.dish.create({
          data: {
            traiteurId: tenant.traiteurId,
            slug: 'x',
            name: { fr: 'X' },
            priceHt: 1_000,
            priceTtc: 900,
          },
        }),
      ).rejects.toThrow(/Dish_prices_check/);
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
      ).rejects.toThrow(/Review_rating_check/);
    });
  });

  describe('factures et avoirs', () => {
    it.each(['TTC', 'HT'] as const)(
      'crée une facture cohérente en mode %s avec récapitulatif de TVA à deux taux',
      async (priceMode) => {
        const tenant = await createTenant(prisma);
        const order = await createOrder(prisma, tenant, { priceMode });
        const invoice = await createInvoice(tenant.traiteurId, order.id, { priceMode });
        expect(invoice.lines).toHaveLength(3);
        expect(invoice.lines.every((line) => line.priceMode === priceMode)).toBe(true);
        expect(invoice.taxBreakdown).toEqual(buildInvoiceAmounts(priceMode).taxBreakdown);
      },
    );

    it('refuse toute modification ou suppression d’une facture émise', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);

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
      const [line] = sampleLines('TTC');
      if (!line) throw new Error('ligne attendue');
      await expect(
        prisma.invoiceLine.create({
          data: {
            ...toLineRow(line),
            traiteurId: tenant.traiteurId,
            invoiceId: invoice.id,
            priceMode: 'TTC',
          },
        }),
      ).rejects.toThrow(/incohérents/);
    });

    it('refuse une facture dont les totaux ne correspondent pas aux lignes', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const { lines, totals, taxBreakdown } = buildInvoiceAmounts();
      await expect(
        prisma.invoice.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            number: `FAC-TEST-${randomUUID().slice(0, 8)}`,
            year: 2026,
            sequenceNumber: 1,
            priceMode: 'TTC',
            totalHt: totals.totalHt + 100,
            totalTax: totals.totalTax,
            totalTtc: totals.totalTtc + 100,
            taxBreakdown,
            sellerSnapshot: SELLER,
            buyerSnapshot: BUYER,
            lines: { create: lines },
          },
        }),
      ).rejects.toThrow(/incohérents/);
    });

    it('refuse un récapitulatif de TVA qui ne correspond pas aux lignes', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const { lines, totals, taxBreakdown } = buildInvoiceAmounts();
      const tampered = taxBreakdown.map((entry, index) =>
        index === 0
          ? { ...entry, baseHt: entry.baseHt + 1, taxAmount: entry.taxAmount - 1 }
          : entry,
      );
      await expect(
        prisma.invoice.create({
          data: {
            traiteurId: tenant.traiteurId,
            orderId: order.id,
            number: `FAC-TEST-${randomUUID().slice(0, 8)}`,
            year: 2026,
            sequenceNumber: 1,
            priceMode: 'TTC',
            ...totals,
            taxBreakdown: tampered,
            sellerSnapshot: SELLER,
            buyerSnapshot: BUYER,
            lines: { create: lines },
          },
        }),
      ).rejects.toThrow(/récapitulatif de TVA/);
    });

    it('accepte un avoir négatif qui annule la facture, refuse un avoir sans référence', async () => {
      const tenant = await createTenant(prisma);
      const order = await createOrder(prisma, tenant);
      const invoice = await createInvoice(tenant.traiteurId, order.id);

      const creditNote = await createInvoice(tenant.traiteurId, order.id, {
        type: 'CREDIT_NOTE',
        originalInvoiceId: invoice.id,
        sign: -1,
      });
      expect(creditNote.totalTtc).toBe(-invoice.totalTtc);
      expect(creditNote.totalHt).toBe(-invoice.totalHt);
      expect(creditNote.totalTax).toBe(-invoice.totalTax);

      await expect(
        createInvoice(tenant.traiteurId, order.id, { type: 'CREDIT_NOTE', sign: -1 }),
      ).rejects.toThrow(/Invoice_type_amounts_check/);
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
