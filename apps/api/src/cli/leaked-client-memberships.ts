/**
 * Nettoyage des inscriptions « client » créées par erreur : avant la correction de la connexion à
 * l'espace de gestion, un membre du personnel d'un traiteur qui se connectait au back-office
 * d'un autre traiteur y était inscrit automatiquement comme CLIENT. Sur le serveur uniquement :
 *
 *   /opt/traiteur/scripts/compose.sh run --rm api node dist/cli/leaked-client-memberships.js
 *
 * La commande liste ce qui serait supprimé, demande « oui », supprime, puis inscrit chaque
 * suppression au journal d'audit du traiteur concerné. Sans « oui », rien n'est modifié.
 */
import { createInterface } from 'node:readline/promises';

import {
  findLeakedClientMemberships,
  removeLeakedClientMemberships,
} from '../staff/leaked-client-memberships';
import { cliPrisma } from './cli-prisma';

const print = (message = ''): void => {
  process.stdout.write(`${message}\n`);
};

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('\nTapez « oui » pour supprimer ces inscriptions : ');
    return answer.trim().toLowerCase() === 'oui';
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const prisma = cliPrisma();
  try {
    const leaked = await findLeakedClientMemberships(prisma);
    if (leaked.length === 0) {
      print('Aucune inscription client créée par erreur : rien à supprimer.');
      return;
    }
    print(`Inscriptions client créées par erreur (${leaked.length}) :`);
    for (const entry of leaked) {
      print(
        `  - ${entry.userName} (${entry.phone}) : CLIENT chez « ${entry.traiteurName} » depuis le ` +
          `${entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')} ; personnel de ` +
          `${entry.staffOf.map((name) => `« ${name} »`).join(', ')}`,
      );
    }
    print(
      'Aucune de ces inscriptions n’a de commande, d’adresse, de conversation, de message ni d’avis.',
    );
    if (!(await confirm())) {
      print('Annulé : rien n’a été modifié.');
      process.exitCode = 1;
      return;
    }
    const removed = await removeLeakedClientMemberships(prisma, leaked);
    print(`✓ ${removed} inscription(s) supprimée(s), tracée(s) dans le journal d’audit.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
