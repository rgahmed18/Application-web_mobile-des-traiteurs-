import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SiteCatalog } from '@/features/site/site-catalog';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.catalog');
  return { title: t('title') };
}

export default function CataloguePage() {
  return <SiteCatalog />;
}
