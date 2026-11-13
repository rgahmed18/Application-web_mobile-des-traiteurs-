// Vide les caches et sorties de build régénérables : cache Turborepo (.turbo), caches Next.js
// (.next/cache, build des parcours .next-e2e), dossiers dist et fichiers *.tsbuildinfo des
// applications et des paquets, restes des parcours e2e (boîte d'envoi, rapports Playwright).
// Les *.tsbuildinfo partent avec dist : sinon la compilation incrémentale croit la sortie à
// jour et ne la régénère pas. À lancer serveurs de développement et tests arrêtés ; `pnpm build`
// (ou `pnpm dev`, qui construit d'abord les paquets) régénère tout.
// Supprime aussi les conteneurs, volumes et réseaux Docker orphelins des tests (étiquette
// `gestion-traiteurs.test`, laissés par une exécution tuée) ; jamais les volumes du projet
// (postgres, redis, storage), qui ne portent pas cette étiquette.
import { execFileSync } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEST_LABEL = 'gestion-traiteurs.test';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Taille totale d'un fichier ou d'un dossier, en octets. */
async function sizeOf(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await sizeOf(join(path, entry));
  return total;
}

/** Dossiers des applications et des paquets du monorepo. */
async function workspaces() {
  const dirs = [];
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    if (!(await exists(base))) continue;
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(base, entry.name));
    }
  }
  return dirs;
}

/** Commande Docker ; null si Docker est absent ou ne répond pas. */
function docker(args) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** Conteneurs, puis volumes et réseaux des tests (étiquette TEST_LABEL). */
function cleanDockerTestResources() {
  const filter = `label=${TEST_LABEL}`;
  const kinds = [
    { name: 'conteneur', list: ['ps', '-aq', '--filter', filter], remove: ['rm', '-f', '-v'] },
    { name: 'volume', list: ['volume', 'ls', '-q', '--filter', filter], remove: ['volume', 'rm'] },
    {
      name: 'réseau',
      list: ['network', 'ls', '-q', '--filter', filter],
      remove: ['network', 'rm'],
    },
  ];
  for (const kind of kinds) {
    const output = docker(kind.list);
    if (output === null) {
      console.log('Docker indisponible : ressources Docker des tests non vérifiées');
      return;
    }
    const ids = output.split(/\s+/).filter(Boolean);
    if (ids.length === 0) continue;
    const removed = docker([...kind.remove, ...ids]) !== null;
    console.log(`${removed ? '✓' : '✗'} ${ids.length} ${kind.name}(s) Docker de test`);
  }
}

const targets = [join(root, '.turbo')];
for (const dir of await workspaces()) {
  targets.push(
    join(dir, '.next', 'cache'),
    join(dir, '.next-e2e'),
    join(dir, '.e2e-outbox'),
    join(dir, 'test-results'),
    join(dir, 'playwright-report'),
    join(dir, 'dist'),
    join(dir, 'dist-seed'),
    join(dir, '.turbo'),
  );
  for (const entry of await readdir(dir)) {
    if (entry.endsWith('.tsbuildinfo')) targets.push(join(dir, entry));
  }
}

let freed = 0;
for (const target of targets) {
  if (!(await exists(target))) continue;
  const size = await sizeOf(target);
  await rm(target, { recursive: true, force: true });
  freed += size;
  console.log(`✓ ${relative(root, target)} (${(size / 1024 / 1024).toFixed(1)} Mo)`);
}
console.log(`Espace libéré : ${(freed / 1024 / 1024).toFixed(1)} Mo`);

cleanDockerTestResources();
