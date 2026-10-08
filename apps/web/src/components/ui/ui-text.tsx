'use client';

import { useTranslations } from 'next-intl';

type UiTextId = 'close' | 'sidebarTitle' | 'sidebarDescription' | 'toggleSidebar' | 'morePages';

/** Texte traduit des composants shadcn (libellés pour lecteurs d'écran, boutons génériques). */
export function UiText({ id }: { id: UiTextId }) {
  const t = useTranslations('ui');
  return t(id);
}
