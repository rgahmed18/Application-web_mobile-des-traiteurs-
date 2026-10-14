/**
 * Catalogue des permissions et matrice par défaut des rôles (RolePermission sans traiteur).
 * Exécuté à chaque déploiement, juste après les migrations : en production il n'y a pas de seed.
 * Idempotent ; les surcharges propres à chaque traiteur ne sont jamais modifiées.
 *
 *   node dist/cli/sync-permissions.js
 */
import { syncPermissionCatalog } from '../access/permission-catalog';
import { cliPrisma } from './cli-prisma';

/** Sortie de la commande (les journaux d'erreur passent par console.error). */
const print = (message: string): void => {
  process.stdout.write(`${message}
`);
};

async function main(): Promise<void> {
  const prisma = cliPrisma();
  try {
    const { permissions, defaultGrants } = await syncPermissionCatalog(prisma);
    print(`✓ ${permissions} permissions, ${defaultGrants} droits par défaut`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
