import type { LocalizedText } from '@traiteur/shared';
import { useLocale } from 'next-intl';
import { useCallback } from 'react';

/**
 * Élément de liste (type d'événement, gamme, type de buffet, catégorie) montré sur le site dans
 * cette langue : en arabe, seulement s'il a un nom arabe (jamais de repli sur le français).
 */
export function listShownIn(locale: string, item: { name: LocalizedText }): boolean {
  return locale !== 'ar' || Boolean(item.name.ar?.trim());
}

/** listShownIn pour la langue de la page. */
export function useListShown(): (item: { name: LocalizedText }) => boolean {
  const locale = useLocale();
  return useCallback((item) => listShownIn(locale, item), [locale]);
}
