import { z } from 'zod';

import { getLocalizedText, type Locale, type LocalizedText } from '../i18n/localized-text';

/**
 * Libellé d'une ligne de commande, de devis ou de facture : figé dans toutes les langues
 * disponibles au moment de l'ajout (copie du nom du catalogue, ou saisie libre). Chaque document
 * s'affiche dans sa langue, avec repli sur le français.
 */
const MAX_LABEL = 200;
const text = z.string().trim().min(1).max(MAX_LABEL);

/** Forme enregistrée (colonne JSONB `label`) : le français est toujours présent. */
export const lineLabelSchema = z.strictObject({
  fr: text,
  ar: text.optional(),
  en: text.optional(),
});
export type LineLabel = z.infer<typeof lineLabelSchema>;

/**
 * Saisie : français et/ou arabe (une ligne libre peut n'être saisie qu'en arabe). Les traductions
 * vides sont ignorées ; sans français, le texte disponible sert de repli.
 */
export const lineLabelInputSchema = z
  .object({
    fr: z.string().trim().max(MAX_LABEL).optional(),
    ar: z.string().trim().max(MAX_LABEL).optional(),
    en: z.string().trim().max(MAX_LABEL).optional(),
  })
  .transform((value, ctx): LineLabel => {
    const ar = value.ar || undefined;
    const en = value.en || undefined;
    const fr = value.fr || ar || en;
    if (!fr) {
      ctx.addIssue({ code: 'custom', message: 'Libellé requis', params: { i18n: 'required' } });
      return z.NEVER;
    }
    return { fr, ...(ar ? { ar } : {}), ...(en ? { en } : {}) };
  });

/** Libellé dans une langue, avec repli sur le français. */
export function lineLabelText(label: LocalizedText, locale: Locale | 'fr' | 'ar'): string {
  return getLocalizedText(label, locale);
}

/** Forme canonique (ordre des clés fixe) pour comparer deux libellés. */
export function lineLabelKey(label: LocalizedText): string {
  return JSON.stringify([label.fr, label.ar ?? null, label.en ?? null]);
}
