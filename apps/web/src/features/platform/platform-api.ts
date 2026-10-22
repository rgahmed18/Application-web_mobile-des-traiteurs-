'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type PlatformDashboard,
  platformDashboardSchema,
  type PlatformTraiteurCreateInput,
  platformTraiteurCreateResultSchema,
  type PlatformTraiteurListQuery,
  type PlatformTraiteurPage,
  platformTraiteurPageSchema,
} from '@traiteur/shared';

import { apiRequest } from '@/lib/api/client';

export const platformKeys = {
  all: ['platform'] as const,
  dashboard: () => ['platform', 'dashboard'] as const,
};

/** Tableau de bord de la plateforme (chiffres agrégés, rafraîchi chaque minute). */
export function usePlatformDashboard(): UseQueryResult<PlatformDashboard> {
  return useQuery({
    queryKey: platformKeys.dashboard(),
    queryFn: ({ signal }) =>
      apiRequest('/platform/dashboard', { schema: platformDashboardSchema, signal }),
    refetchInterval: 60_000,
  });
}

/** Traiteurs de la plateforme (recherche, statut, offre, pages). */
export function usePlatformTraiteurs(
  query: Partial<PlatformTraiteurListQuery>,
): UseQueryResult<PlatformTraiteurPage> {
  return useQuery({
    queryKey: [...platformKeys.all, 'traiteurs', query],
    queryFn: ({ signal }) =>
      apiRequest('/platform/traiteurs', {
        query,
        schema: platformTraiteurPageSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePlatformTraiteur() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformTraiteurCreateInput) =>
      apiRequest('/platform/traiteurs', {
        method: 'POST',
        body: input,
        schema: platformTraiteurCreateResultSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.all }),
  });
}

/** Nouveau lien d'activation de l'administrateur d'un traiteur. */
export function useResendAdminInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (traiteurId: string) =>
      apiRequest(`/platform/traiteurs/${traiteurId}/admin-invitation`, {
        method: 'POST',
        schema: platformTraiteurCreateResultSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.all }),
  });
}
