'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { ClientLoginFlow } from './client-login-flow';
import { useClientSession } from './client-session-provider';
import { siteNextPath } from './site-redirect';

/** Connexion ou inscription du client ; déjà connecté : directement sur la page demandée. */
export function SiteLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useClientSession();
  const next = siteNextPath(params.get('suite'));

  useEffect(() => {
    if (session.status === 'authenticated') router.replace(next);
  }, [session.status, router, next]);

  if (session.status !== 'anonymous') {
    return <Skeleton className="mx-auto h-72 w-full max-w-md" />;
  }
  return <ClientLoginFlow onSignedIn={() => router.replace(next)} />;
}
