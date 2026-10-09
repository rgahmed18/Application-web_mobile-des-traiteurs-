import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  computeDocumentTotals,
  computeLineAmounts,
  type LineAmounts,
  type LineInput,
  type PriceMode,
} from '@traiteur/shared';

import { PrismaClient } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from './test-database-url';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: getTestDatabaseUrl(), max: 20 }),
  });
}

export interface TestTenant {
  traiteurId: string;
  clientMembershipId: string;
}

/** Crée un traiteur isolé (slug unique) avec un client. */
export async function createTenant(prisma: PrismaClient): Promise<TestTenant> {
  const suffix = randomUUID().slice(0, 8);
  const traiteur = await prisma.traiteur.create({
    data: {
      slug: `test-${suffix}`,
      name: `Traiteur ${suffix}`,
      email: 'test@exemple.ma',
      phone: '+212500000000',
    },
  });
  const user = await prisma.user.create({
    data: {
      phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      firstName: 'Client',
      lastName: suffix,
    },
  });
  const membership = await prisma.membership.create({
    data: {
      traiteurId: traiteur.id,
      userId: user.id,
      role: 'CLIENT',
      firstName: 'Client',
      lastName: 'Test',
    },
  });
  return { traiteurId: traiteur.id, clientMembershipId: membership.id };
}

/** Commande vide (totaux à zéro) dans le mode demandé. */
export async function createOrder(
  prisma: PrismaClient,
  tenant: TestTenant,
  options: { reference?: string; priceMode?: PriceMode } = {},
) {
  return prisma.order.create({
    data: {
      traiteurId: tenant.traiteurId,
      clientId: tenant.clientMembershipId,
      reference: options.reference ?? `CMD-${randomUUID().slice(0, 8)}`,
      priceMode: options.priceMode ?? 'TTC',
      eventType: 'WEDDING',
      eventDate: new Date('2026-12-12T18:00:00Z'),
      guestCount: 100,
      venueAddress: 'Salle des fêtes',
      city: 'Casablanca',
    },
  });
}

/** Colonnes d'une ligne (sans priceMode : recopié depuis le document en création imbriquée). */
export function toLineRow(line: LineAmounts, index = 0) {
  return {
    itemType: 'CUSTOM' as const,
    label: `Ligne ${index + 1}`,
    quantity: line.quantity,
    unitPriceHt: line.unitPriceHt,
    unitPriceTtc: line.unitPriceTtc,
    discountHt: line.discountHt,
    discountTtc: line.discountTtc,
    taxRateBps: line.taxRateBps,
    totalHt: line.totalHt,
    taxAmount: line.taxAmount,
    totalTtc: line.totalTtc,
    sortOrder: index,
  };
}

/** Lignes d'exemple calculées avec la logique partagée (deux taux de TVA). */
export function sampleLines(priceMode: PriceMode = 'TTC', sign: 1 | -1 = 1): LineAmounts[] {
  const make = (unitPrice: number, quantity: number, taxRateBps: number): LineInput =>
    priceMode === 'TTC'
      ? { priceMode, unitPriceTtc: sign * unitPrice, quantity, taxRateBps }
      : { priceMode, unitPriceHt: sign * unitPrice, quantity, taxRateBps };
  return [
    computeLineAmounts(make(25_000, 120, 2000)),
    computeLineAmounts(make(1_500, 120, 1000)),
    computeLineAmounts(make(800_000, 1, 2000)),
  ];
}

/** Lignes, totaux et récapitulatif de TVA d'une facture cohérente. */
export function buildInvoiceAmounts(priceMode: PriceMode = 'TTC', sign: 1 | -1 = 1) {
  const lines = sampleLines(priceMode, sign);
  const totals = computeDocumentTotals(lines);
  return {
    lines: lines.map(toLineRow),
    totals: { totalHt: totals.totalHt, totalTax: totals.totalTax, totalTtc: totals.totalTtc },
    taxBreakdown: totals.taxBreakdown.map((entry) => ({ ...entry })),
  };
}
