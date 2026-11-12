import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { RequireClient } from '@/features/site/require-client';
import { SpaceShell } from '@/features/site/space/space-shell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.space');
  return { title: t('title'), robots: { index: false } };
}

/** Espace du client : réservé aux clients connectés de ce traiteur. */
export default function EspaceLayout({ children }: { children: ReactNode }) {
  return (
    <RequireClient>
      <SpaceShell>{children}</SpaceShell>
    </RequireClient>
  );
}
