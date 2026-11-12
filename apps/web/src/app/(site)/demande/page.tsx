import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequestPage } from '@/features/site/request-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.cart');
  return { title: t('title'), robots: { index: false } };
}

export default function DemandePage() {
  return <RequestPage />;
}
