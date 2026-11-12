import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ClientSessionProvider } from '@/features/site/client-session-provider';
import { SiteShell } from '@/features/site/site-shell';
import { currentSpace } from '@/lib/space/space.server';

export async function generateMetadata(): Promise<Metadata> {
  const space = await currentSpace();
  return space?.kind === 'traiteur' ? { title: space.traiteur.name } : {};
}

/**
 * Site client d'un traiteur, à la racine de son adresse (le back-office reste sous /admin) :
 * jamais sur l'adresse de la console. Session propre aux clients, distincte du back-office.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  if ((await currentSpace())?.kind !== 'traiteur') notFound();
  return (
    <ClientSessionProvider>
      <SiteShell>{children}</SiteShell>
    </ClientSessionProvider>
  );
}
