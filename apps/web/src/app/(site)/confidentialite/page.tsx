import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PrivacyPolicy } from '@/features/site/privacy-policy';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.privacy');
  return { title: t('title') };
}

export default function ConfidentialitePage() {
  return <PrivacyPolicy />;
}
