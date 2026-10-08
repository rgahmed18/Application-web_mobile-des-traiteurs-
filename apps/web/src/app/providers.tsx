'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Direction } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from '@/features/auth/session-provider';
import { isApiError } from '@/lib/api/errors';

interface ProvidersProps {
  children: ReactNode;
  /** Sens d'écriture de la langue courante : les composants Radix s'y adaptent (menus, clavier). */
  dir: 'ltr' | 'rtl';
}

/** Fournisseurs côté client : direction, session, requêtes, infobulles, notifications. */
export function Providers({ children, dir }: ProvidersProps) {
  // Un QueryClient par onglet, créé une seule fois.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Pas de nouvel essai sur une erreur métier (4xx) : seulement sur une panne réseau ou 5xx
            retry: (failureCount, error) =>
              failureCount < 2 && !(isApiError(error) && error.status < 500),
          },
        },
      }),
  );

  return (
    <Direction.Provider dir={dir}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SessionProvider>
        <Toaster position="top-center" dir={dir} richColors closeButton />
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      </QueryClientProvider>
    </Direction.Provider>
  );
}
