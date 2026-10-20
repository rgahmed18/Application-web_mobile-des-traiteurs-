import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Le paquet partagé tourne aussi dans le navigateur (back-office), jusqu'à Safari 15 et Chrome 87.
 * Une syntaxe qu'un navigateur ne sait pas lire fait échouer TOUT le fichier JavaScript qui la
 * contient : aucune transpilation ne la corrige pour les expressions régulières.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('compatibilité navigateurs du paquet partagé', () => {
  it("n'utilise aucune assertion arrière (?<= / (?<! dans les expressions régulières (Safari < 16.4)", () => {
    const offenders = sources(__dirname).filter((file) =>
      /\(\?<[=!]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
