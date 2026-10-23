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
  type PlatformPlans,
  platformPlansSchema,
  type PlatformTraiteurDetail,
  platformTraiteurDetailSchema,
  type SubscriptionPlan,
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

export function usePlatformTraiteur(id: string): UseQueryResult<PlatformTraiteurDetail> {
  return useQuery({
    queryKey: [...platformKeys.all, 'traiteur', id],
    queryFn: ({ signal }) =>
      apiRequest(`/platform/traiteurs/${id}`, { schema: platformTraiteurDetailSchema, signal }),
  });
}

/** Action sur la fiche d'un traiteur : la réponse est la fiche à jour. */
export function useTraiteurAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: {
      method: 'POST' | 'PUT';
      path: string;
      body?: Record<string, unknown>;
    }) =>
      apiRequest(`/platform/traiteurs/${id}${action.path}`, {
        method: action.method,
        body: action.body,
        schema: platformTraiteurDetailSchema,
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData([...platformKeys.all, 'traiteur', id], detail);
      await queryClient.invalidateQueries({ queryKey: platformKeys.all });
    },
  });
}

export function usePlatformPlans(): UseQueryResult<PlatformPlans> {
  return useQuery({
    queryKey: [...platformKeys.all, 'plans'],
    queryFn: ({ signal }) => apiRequest('/platform/plans', { schema: platformPlansSchema, signal }),
  });
}

export function useSetPlanPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ plan, monthlyPrice }: { plan: SubscriptionPlan; monthlyPrice: number }) =>
      apiRequest(`/platform/plans/${plan}/price`, {
        method: 'PUT',
        body: { monthlyPrice },
        schema: platformPlansSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.all }),
  });
}
