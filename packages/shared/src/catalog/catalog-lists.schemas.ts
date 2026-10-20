import { z } from 'zod';

import { localizedTextSchema } from '../i18n/localized-text';

/**
 * Listes gérables du catalogue, propres à chaque traiteur et traduites : types d'événement et
 * gammes (puis types de buffet et catégories de matériel). Chaque élément a un code stable,
 * généré à la création depuis le nom français, que les commandes et le catalogue référencent ;
 * nom, ordre et activation restent modifiables. Un élément utilisé ne se supprime pas : il
 * s'archive (retiré des nouvelles saisies, conservé pour l'historique).
 */
export const CATALOG_LISTS = ['event-types', 'ranges'] as const;
export const catalogListSchema = z.enum(CATALOG_LISTS);
export type CatalogList = z.infer<typeof catalogListSchema>;

export const catalogListItemInputSchema = z.object({
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  isActive: z.boolean(),
});
export type CatalogListItemInput = z.infer<typeof catalogListItemInputSchema>;

export const catalogListReorderSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
});
export type CatalogListReorderInput = z.infer<typeof catalogListReorderSchema>;

export const catalogListItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: localizedTextSchema,
  /** Gammes uniquement (null pour les types d'événement). */
  description: localizedTextSchema.nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  archived: z.boolean(),
  /** Nombre d'utilisations (commandes, éléments du catalogue) : supprimable seulement à 0. */
  usageCount: z.number().int(),
});
export type CatalogListItem = z.infer<typeof catalogListItemSchema>;

/**
 * Code stable généré depuis un nom : « Soutenance de thèse » → « SOUTENANCE_DE_THESE ».
 * Majuscules sans accents, chiffres et « _ », 40 caractères au plus, commence par une lettre.
 */
export function catalogListCode(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  return /^[A-Z]/.test(base) ? base : `T_${base}`.replace(/_+$/, '');
}
