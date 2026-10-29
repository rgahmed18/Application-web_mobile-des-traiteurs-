import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUDIT_ACTIONS } from '@traiteur/shared';

/** Fichiers source de l'API (hors code généré et tests). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('registre des actions du journal d’audit', () => {
  it('toute action écrite dans le code figure au registre partagé (libellés FR et AR)', () => {
    // AuditService est typé ; ce test couvre aussi les écritures directes (commandes serveur)
    const literal = /action: '([a-z0-9_]+\.[a-z0-9_.]+)'/g;
    const unknown = sourceFiles(join(__dirname, '..')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(literal)]
        .map((match) => match[1] ?? '')
        .filter((action) => !(AUDIT_ACTIONS as readonly string[]).includes(action))
        .map((action) => `${action} (${file})`),
    );
    expect(unknown).toEqual([]);
  });

  it('pas de doublon', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});
