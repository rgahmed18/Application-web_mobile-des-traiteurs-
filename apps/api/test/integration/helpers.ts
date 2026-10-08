import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { computeDocumentTotals, computeLineAmounts } from '@traiteur/shared';

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
    data: { traiteurId: traiteur.id, userId: user.id, role: 'CLIENT' },
  });
  return { traiteurId: traiteur.id, clientMembershipId: membership.id };
}

export async function createOrder(
  prisma: PrismaClient,
  tenant: TestTenant,
  reference = `CMD-${randomUUID().slice(0, 8)}`,
) {
  return prisma.order.create({
    data: {
      traiteurId: tenant.traiteurId,
      clientId: tenant.clientMembershipId,
      reference,
      eventType: 'WEDDING',
      eventDate: new Date('2026-12-12T18:00:00Z'),
      guestCount: 100,
      venueAddress: 'Salle des fêtes',
      city: 'Casablanca',
    },
  });
}

/** Lignes et totaux cohérents, calculés avec la logique partagée. */
export function buildInvoiceAmounts(sign: 1 | -1 = 1) {
  const lines = [
    computeLineAmounts({ unitPriceHt: sign * 29_167, quantity: 100, taxRateBps: 2000 }),
    computeLineAmounts({ unitPriceHt: sign * 150_000, quantity: 1, taxRateBps: 2000 }),
  ];
  const totals = computeDocumentTotals(lines);
  return {
    lines: lines.map((line, index) => ({
      itemType: 'CUSTOM' as const,
      label: `Ligne ${index + 1}`,
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      discountHt: line.discountHt,
      taxRateBps: line.taxRateBps,
      totalHt: line.totalHt,
      taxAmount: line.taxAmount,
      totalTtc: line.totalTtc,
      sortOrder: index,
    })),
    totals: { totalHt: totals.totalHt, totalTax: totals.totalTax, totalTtc: totals.totalTtc },
  };
}
