// Vérification des types du back-office : types des routes générés par Next, puis tsc.
//
// Les types sont générés dans un dossier DÉDIÉ (.next-typegen), jamais dans .next : turbo lance
// « build » et « typecheck » en parallèle, et « next build » commence par vider .next. Dans le
// même dossier, le build supprimait parfois .next/types/routes.d.ts pendant que typegen
// l'écrivait (ENOENT aléatoire dans la CI).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const env = { ...process.env, NEXT_DIST_DIR: '.next-typegen' };

/** Programme d'un paquet lancé avec Node (sans shell : identique sous Windows et Linux). */
function run(bin, args) {
  const result = spawnSync(process.execPath, [require.resolve(bin), ...args], {
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('next/dist/bin/next', ['typegen']);
run('typescript/bin/tsc', ['--noEmit']);
