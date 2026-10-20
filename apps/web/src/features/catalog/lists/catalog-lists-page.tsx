'use client';

import { CATALOG_LISTS } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

import { CatalogHeader } from '../components/catalog-header';
import { CatalogListSection } from './catalog-list-section';

/** Listes du catalogue : types d'événement et gammes, gérés par l'administrateur. */
export function CatalogListsPage() {
  const t = useTranslations('catalog');
  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader />
      <p className="max-w-3xl text-muted-foreground">{t('lists.description')}</p>
      {CATALOG_LISTS.map((list) => (
        <CatalogListSection key={list} list={list} />
      ))}
    </div>
  );
}
