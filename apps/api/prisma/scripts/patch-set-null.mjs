// Réécrit, dans une migration générée par Prisma, les clés étrangères composites
// facultatives (colonne, "traiteurId") pour que leur suppression vide uniquement la colonne
// facultative et jamais traiteurId :
//   ON DELETE SET NULL  →  ON DELETE SET NULL ("colonne")      (PostgreSQL 15+)
//
// Usage : pnpm --filter @traiteur/api db:patch-set-null prisma/migrations/<dossier>/migration.sql
// À lancer après `prisma migrate dev --create-only`, avant d'appliquer la migration.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , file] = process.argv;
if (!file) {
  console.error('Usage : node prisma/scripts/patch-set-null.mjs <migration.sql>');
  process.exit(1);
}

let count = 0;
const sql = readFileSync(file, 'utf8').replace(
  /FOREIGN KEY \("(\w+)", "traiteurId"\) REFERENCES ("\w+")\("id", "traiteurId"\) ON DELETE SET NULL(?! \()/g,
  (_match, column, table) => {
    count += 1;
    return `FOREIGN KEY ("${column}", "traiteurId") REFERENCES ${table}("id", "traiteurId") ON DELETE SET NULL ("${column}")`;
  },
);
writeFileSync(file, sql);
console.log(`Clés composites réécrites en SET NULL (colonne) : ${count}`);
