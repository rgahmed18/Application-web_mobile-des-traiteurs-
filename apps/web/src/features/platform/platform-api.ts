'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type PlatformPermissionMatrix,
  platformPermissionMatrixSchema,
  type PlatformAuditOptions,
  platformAuditOptionsSchema,
  type PlatformAuditPage,
  platformAuditPageSchema,
  type PlatformAuditQuery,
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

/** Journal d'audit de la console (filtres : portée, auteur, action, traiteur, période). */
export function usePlatformAudit(
  query: Partial<PlatformAuditQuery>,
): UseQueryResult<PlatformAuditPage> {
  return useQuery({
    queryKey: [...platformKeys.all, 'audit', query],
    queryFn: ({ signal }) =>
      apiRequest('/platform/audit', { query, schema: platformAuditPageSchema, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Valeurs proposées par les filtres du journal. */
export function usePlatformAuditOptions(): UseQueryResult<PlatformAuditOptions> {
  return useQuery({
    queryKey: [...platformKeys.all, 'audit', 'options'],
    queryFn: ({ signal }) =>
      apiRequest('/platform/audit/options', { schema: platformAuditOptionsSchema, signal }),
  });
}

const permissionsKey = [...platformKeys.all, 'permissions'] as const;

/** Matrice des permissions par défaut (tous les traiteurs). */
export function usePlatformPermissions(): UseQueryResult<PlatformPermissionMatrix> {
  return useQuery({
    queryKey: permissionsKey,
    queryFn: ({ signal }) =>
      apiRequest('/platform/permissions', { schema: platformPermissionMatrixSchema, signal }),
  });
}

/** Une case de la matrice par défaut : effet immédiat chez tous les traiteurs. */
export function useSetPlatformPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, key, granted }: { role: string; key: string; granted: boolean }) =>
      apiRequest(`/platform/permissions/${role}/${key}`, {
        method: 'PUT',
        body: { granted },
        schema: platformPermissionMatrixSchema,
      }),
    onSuccess: (matrix) => queryClient.setQueryData(permissionsKey, matrix),
  });
}
