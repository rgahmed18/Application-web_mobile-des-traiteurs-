import { redirect } from 'next/navigation';

import { ClientSessionProvider } from '@/features/site/client-session-provider';
import { SiteHome } from '@/features/site/site-home';
import { SiteShell } from '@/features/site/site-shell';
import { currentSpace } from '@/lib/space/space.server';

/**
 * Racine de l'adresse : sur celle d'un traiteur, l'accueil de son site client (même cadre que
 * les autres pages du site) ; sur celle de la console, direction le back-office.
 */
export default async function HomePage() {
  if ((await currentSpace())?.kind !== 'traiteur') redirect('/admin');
  return (
    <ClientSessionProvider>
      <SiteShell>
        <SiteHome />
      </SiteShell>
    </ClientSessionProvider>
  );
}
