'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type PlatformDashboard, platformDashboardSchema } from '@traiteur/shared';

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
