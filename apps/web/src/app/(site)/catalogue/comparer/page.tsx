import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RangeComparator } from '@/features/site/range-comparator';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.compare');
  return { title: t('kicker') };
}

/** Comparateur de gammes pour un type d'événement (?type=WEDDING). */
export default function ComparePage() {
  return <RangeComparator />;
}
