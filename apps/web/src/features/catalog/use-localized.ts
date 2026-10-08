'use client';

import { getLocalizedText, type LocalizedText } from '@traiteur/shared';
import { useLocale } from 'next-intl';
import { useCallback } from 'react';

/** Texte traduisible dans la langue de l'interface, avec repli sur le français. */
export function useLocalized(): (text: LocalizedText) => string {
  const locale = useLocale();
  return useCallback((text: LocalizedText) => getLocalizedText(text, locale), [locale]);
}
