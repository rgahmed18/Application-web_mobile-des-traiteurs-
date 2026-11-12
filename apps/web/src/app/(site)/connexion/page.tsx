import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SiteLoginPage } from '@/features/site/site-login-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.login');
  return { title: t('title'), robots: { index: false } };
}

export default function ConnexionPage() {
  return <SiteLoginPage />;
}
