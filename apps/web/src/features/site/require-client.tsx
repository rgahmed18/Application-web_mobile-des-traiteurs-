'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { useClientSession } from './client-session-provider';
import { siteLoginHref } from './site-redirect';

/** Page réservée aux clients connectés : sinon, connexion puis retour sur cette page. */
export function RequireClient({ children }: { children: ReactNode }) {
  const session = useClientSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'anonymous') router.replace(siteLoginHref(pathname));
  }, [session.status, router, pathname]);

  if (session.status !== 'authenticated') return <Skeleton className="h-64 w-full" />;
  return children;
}
