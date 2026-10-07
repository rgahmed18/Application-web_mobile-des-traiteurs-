import { z } from 'zod';

/** Langues supportées par la plateforme. */
export const LOCALES = ['fr', 'ar', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/** Langue de repli : toujours renseignée dans un LocalizedText. */
export const DEFAULT_LOCALE = 'fr' satisfies Locale;

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

/** Indique si une langue s'écrit de droite à gauche. */
export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

/** Sens d'écriture à appliquer (attribut HTML `dir`, I18nManager côté mobile). */
export function getTextDirection(locale: Locale): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

const translationSchema = z.string().trim().min(1);

/**
 * Texte traduisible stocké en JSONB : le français est obligatoire,
 * l'arabe et l'anglais sont facultatifs.
 */
export const localizedTextSchema = z.strictObject({
  fr: translationSchema,
  ar: translationSchema.optional(),
  en: translationSchema.optional(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/**
 * Retourne le texte dans la langue demandée, avec repli sur le français
 * si la traduction n'existe pas.
 */
export function getLocalizedText(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text.fr;
}

/**
 * Valide une valeur inconnue (ex. colonne JSON lue en base) et la convertit en LocalizedText.
 * Lève une ZodError si la valeur est invalide.
 */
export function parseLocalizedText(value: unknown): LocalizedText {
  return localizedTextSchema.parse(value);
}
