// Worker en développement (pnpm dev:worker) : il tourne sur le code compilé par l'API
// (`nest start --watch` écrit dist/) au lieu d'un second compilateur en mode watch. Il attend
// la première compilation (worker.js stable), puis Node le relance à chaque sortie dans dist/.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const entry = join(dist, 'worker.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Date d'écriture de dist/worker.js, ou null tant qu'il n'existe pas. */
const written = () => (existsSync(entry) ? statSync(entry).mtimeMs : null);

// Au démarrage, Nest efface dist/ puis recompile : on attend un worker.js écrit depuis notre
// lancement et stable depuis 3 s (sinon, si l'API tournait déjà, le dist/ existant après 2 min)
const startedAt = Date.now();
process.stdout.write('Worker : en attente de la compilation de l’API (dist/)…\n');
for (;;) {
  const before = written();
  await sleep(3_000);
  const fresh = before !== null && before >= startedAt;
  const waitedLong = Date.now() - startedAt > 120_000;
  if (before !== null && written() === before && (fresh || waitedLong)) break;
}

const child = spawn(process.execPath, ['--watch-path', dist, '--watch-preserve-output', entry], {
  cwd: root,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
