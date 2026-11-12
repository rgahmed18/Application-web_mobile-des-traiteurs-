import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ClientAccountHome } from '@/features/site/client-account-home';
import { RequireClient } from '@/features/site/require-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.account');
  return { title: t('title'), robots: { index: false } };
}

export default function EspacePage() {
  return (
    <RequireClient>
      <ClientAccountHome />
    </RequireClient>
  );
}
