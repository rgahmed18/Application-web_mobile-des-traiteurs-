import type { QueryValue } from './client';

/** Paramètres d'URL : valeurs absentes retirées, listes jointes par des virgules. */
export function toQuery(values: object): Record<string, QueryValue> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : (value as QueryValue)]),
  );
}
