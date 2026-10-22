import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RequireSession } from '@/features/auth/auth-gates';
import { ConsoleShell } from '@/features/platform/console-shell';

export const metadata: Metadata = {
  title: 'Console plateforme — Gestion Traiteurs',
  robots: { index: false, follow: false },
};

/** Console de la plateforme : réservée au super admin en session plateforme. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession area="platform">
      <ConsoleShell>{children}</ConsoleShell>
    </RequireSession>
  );
}
