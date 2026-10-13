// Vide les caches et sorties de build régénérables : cache Turborepo (.turbo), caches Next.js
// (.next/cache), dossiers dist et fichiers *.tsbuildinfo des applications et des paquets.
// Les *.tsbuildinfo partent avec dist : sinon la compilation incrémentale croit la sortie à
// jour et ne la régénère pas. À lancer serveurs de développement arrêtés ; `pnpm build` (ou
// `pnpm dev`, qui construit d'abord les paquets) régénère tout.
import { readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

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

const targets = [join(root, '.turbo')];
for (const dir of await workspaces()) {
  targets.push(join(dir, '.next', 'cache'), join(dir, 'dist'), join(dir, '.turbo'));
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
