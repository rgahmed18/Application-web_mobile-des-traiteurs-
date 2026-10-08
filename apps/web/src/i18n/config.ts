/** Langues de l'interface du back-office (l'anglais n'est prévu que pour le contenu). */
export const UI_LOCALES = ['fr', 'ar'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = 'fr';

/** Cookie de préférence de langue (pas de langue dans l'URL : back-office non référencé). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

/** Libellé de chaque langue dans sa propre langue (bascule FR / عربية). */
export const LOCALE_LABELS: Readonly<Record<UiLocale, string>> = {
  fr: 'Français',
  ar: 'العربية',
};
