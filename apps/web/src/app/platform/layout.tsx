import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { RequireSession } from '@/features/auth/auth-gates';
import { ConsoleShell } from '@/features/platform/console-shell';
import { currentSpace } from '@/lib/space/space.server';

export const metadata: Metadata = {
  title: 'Console plateforme — Gestion Traiteurs',
  robots: { index: false, follow: false },
};

/**
 * Console de la plateforme : seulement sur l'adresse de la console (jamais sur celle d'un
 * traiteur), réservée au super admin en session plateforme.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  if ((await currentSpace())?.kind !== 'platform') notFound();
  return (
    <RequireSession area="platform">
      <ConsoleShell>{children}</ConsoleShell>
    </RequireSession>
  );
}
