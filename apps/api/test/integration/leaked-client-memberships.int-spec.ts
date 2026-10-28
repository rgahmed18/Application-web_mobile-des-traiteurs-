import { randomUUID } from 'node:crypto';

import type { PrismaClient, Role } from '../../src/generated/prisma/client';
import {
  findLeakedClientMemberships,
  removeLeakedClientMemberships,
} from '../../src/staff/leaked-client-memberships';
import { createOrder, createTestPrisma } from './helpers';

/**
 * Nettoyage des inscriptions « client » créées par erreur à la connexion au back-office : seules
 * celles d'un membre du personnel d'un autre traiteur, postérieures à son entrée dans ce
 * personnel et sans aucune activité de client, sont supprimées (et tracées).
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Inscriptions client créées par erreur', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createTraiteur(name: string) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.traiteur.create({
      data: {
        slug: `fuite-${suffix}`,
        name: `${name} ${suffix}`,
        email: 'test@exemple.ma',
        phone: '+212500000000',
      },
    });
  }

  async function member(userId: string, traiteurId: string, role: Role, createdAt: Date) {
    return prisma.membership.create({
      data: { userId, traiteurId, role, firstName: 'Samir', lastName: role, createdAt },
    });
  }

  it('liste puis supprime seulement les inscriptions créées par erreur, sans activité', async () => {
    const darDiafa = await createTraiteur('Dar Diafa');
    const saveurs = await createTraiteur('Saveurs');
    const day = (offset: number) => new Date(Date.UTC(2026, 9, 1 + offset));
    const newUser = () =>
      prisma.user.create({ data: { phone: randomPhone(), firstName: 'Samir', lastName: 'Test' } });

    // Fuite : administrateur de Saveurs inscrit CLIENT chez Dar Diafa à la connexion
    const leakedUser = await newUser();
    await member(leakedUser.id, saveurs.id, 'ADMIN_TRAITEUR', day(0));
    const leaked = await member(leakedUser.id, darDiafa.id, 'CLIENT', day(1));

    // Vrai client de Dar Diafa devenu ensuite employé de Saveurs : gardé
    const formerClient = await newUser();
    await member(formerClient.id, darDiafa.id, 'CLIENT', day(0));
    await member(formerClient.id, saveurs.id, 'EMPLOYE', day(2));

    // Employé de Saveurs qui a commandé chez Dar Diafa : gardé (activité de client)
    const buyer = await newUser();
    await member(buyer.id, saveurs.id, 'EMPLOYE', day(0));
    const buyerClient = await member(buyer.id, darDiafa.id, 'CLIENT', day(1));
    await createOrder(
      prisma,
      { traiteurId: darDiafa.id, clientMembershipId: buyerClient.id },
      { reference: `CMD-FUITE-${randomUUID().slice(0, 6)}` },
    );

    // Client ordinaire : gardé
    const customer = await newUser();
    await member(customer.id, darDiafa.id, 'CLIENT', day(1));

    const ours = (entries: Awaited<ReturnType<typeof findLeakedClientMemberships>>) =>
      entries.filter((entry) => [darDiafa.id, saveurs.id].includes(entry.traiteurId));
    const found = ours(await findLeakedClientMemberships(prisma));
    expect(found).toEqual([
      expect.objectContaining({
        membershipId: leaked.id,
        traiteurName: darDiafa.name,
        staffOf: [saveurs.name],
      }),
    ]);

    expect(await removeLeakedClientMemberships(prisma, found)).toBe(1);
    expect(await prisma.membership.findUnique({ where: { id: leaked.id } })).toBeNull();
    // Son accès chez Saveurs est intact
    expect(
      await prisma.membership.count({ where: { userId: leakedUser.id, traiteurId: saveurs.id } }),
    ).toBe(1);
    const logged = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'membership.leaked_client_removed', entityId: leaked.id },
    });
    expect(logged.traiteurId).toBe(darDiafa.id);
    expect(ours(await findLeakedClientMemberships(prisma))).toEqual([]);
    for (const kept of [formerClient.id, buyer.id, customer.id]) {
      expect(
        await prisma.membership.count({ where: { userId: kept, traiteurId: darDiafa.id } }),
      ).toBe(1);
    }
  });
});
