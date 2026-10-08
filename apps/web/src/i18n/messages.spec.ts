import { describe, expect, it } from 'vitest';

import ar from '../../messages/ar.json';
import fr from '../../messages/fr.json';

/** Toutes les clés d'un fichier de traduction, à plat (« auth.login.title »). */
function keysOf(messages: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Variables ICU d'un message (« {name} », « {seconds} »). */
function placeholdersOf(message: string): string[] {
  // Variable : « {nom} » ou « {nom, plural, …} » — pas le texte des branches de pluriel
  const names = [...message.matchAll(/\{(\w+)\s*[},]/g)].map((match) => match[1] ?? '');
  return [...new Set(names)].sort();
}

function valueAt(messages: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);
}

describe('fichiers de traduction', () => {
  const frKeys = keysOf(fr).sort();
  const arKeys = keysOf(ar).sort();

  it('fr et ar ont exactement les mêmes clés', () => {
    expect(arKeys.filter((key) => !frKeys.includes(key))).toEqual([]);
    expect(frKeys.filter((key) => !arKeys.includes(key))).toEqual([]);
  });

  it('aucune traduction n’est vide', () => {
    for (const key of frKeys) {
      expect(String(valueAt(fr, key)).trim(), `fr : ${key}`).not.toBe('');
      expect(String(valueAt(ar, key)).trim(), `ar : ${key}`).not.toBe('');
    }
  });

  it('les variables sont identiques dans les deux langues', () => {
    for (const key of frKeys) {
      expect(placeholdersOf(String(valueAt(ar, key))), key).toEqual(
        placeholdersOf(String(valueAt(fr, key))),
      );
    }
  });
});
