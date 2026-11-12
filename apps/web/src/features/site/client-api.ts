'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type ClientAccount, clientAccountSchema } from '@traiteur/shared';

import { apiRequest } from '@/lib/api/client';

import { useClientSession } from './client-session-provider';

/** Clés des requêtes de l'espace client (vidées à la déconnexion avec le reste du cache). */
export const clientKeys = {
  all: ['client'] as const,
  account: ['client', 'account'] as const,
};

/** Compte du client chez ce traiteur : coordonnées de sa fiche, accord du traiteur. */
export function useClientAccount(): UseQueryResult<ClientAccount> {
  const session = useClientSession();
  return useQuery({
    queryKey: clientKeys.account,
    queryFn: ({ signal }) => apiRequest('/client/account', { schema: clientAccountSchema, signal }),
    enabled: session.status === 'authenticated',
  });
}
