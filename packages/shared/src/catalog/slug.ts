/**
 * Identifiant lisible pour les URL (« Tajine d'agneau aux pruneaux » → « tajine-d-agneau-aux-pruneaux »).
 * Construit à partir du nom français ; les accents sont retirés. Si le nom ne contient aucun
 * caractère latin (ex. nom uniquement en arabe), `fallback` est utilisé.
 */
export function slugify(text: string, fallback = 'element'): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[œ]/g, 'oe')
    .replace(/[æ]/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Variante numérotée d'un identifiant déjà pris : « pastilla » → « pastilla-2 ». */
export function numberedSlug(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base.slice(0, 76)}-${attempt}`;
}
