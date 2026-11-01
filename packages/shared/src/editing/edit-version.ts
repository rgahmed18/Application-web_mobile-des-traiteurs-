/**
 * Verrouillage optimiste des modifications : le client présente la version de l'élément qu'il a
 * chargé (en-tête HTTP « If-Match ») ; si l'élément a changé entre-temps, l'API refuse (409
 * EDIT_CONFLICT) au lieu d'écraser le travail de l'autre personne.
 *
 * - catalogue et clients : date de dernière modification (ISO) ;
 * - paramètres : empreinte du CONTENU de la section (les réglages partagent une même ligne :
 *   modifier la facturation ne doit pas bloquer les coordonnées de l'entreprise).
 */

/** En-tête HTTP portant la version attendue. */
export const EDIT_VERSION_HEADER = 'If-Match';

/** Sérialisation stable : clés triées, valeurs undefined omises (comme JSON). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/** FNV-1a 32 bits. */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Empreinte du contenu (identique côté API et côté navigateur pour les mêmes valeurs). */
export function contentVersion(value: unknown): string {
  const text = stableStringify(value);
  return `c-${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

/** Empreinte des seuls champs modifiables par le formulaire (absents : null). */
export function fieldsVersion(fields: readonly string[], value: Record<string, unknown>): string {
  return contentVersion(Object.fromEntries(fields.map((field) => [field, value[field] ?? null])));
}
