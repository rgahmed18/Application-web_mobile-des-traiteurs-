'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type AssignmentBatchInput,
  type AssignmentUpdateInput,
  type CollectionMethod,
  type Mission,
  type MissionListQuery,
  missionSchema,
  type MissionSummary,
  missionSummarySchema,
  type OrderStaffing,
  orderStaffingSchema,
  type Planning,
  planningSchema,
  type ServiceInfoInput,
} from '@traiteur/shared';
import { z } from 'zod';

import { orderKeys } from '@/features/orders/orders-api';
import { apiRequest } from '@/lib/api/client';

export const assignmentKeys = {
  staffing: (orderId: string) => ['orders', 'staffing', orderId] as const,
  planning: (week: string) => ['staff', 'planning', week] as const,
  missions: (scope: MissionListQuery['scope']) => ['missions', 'list', scope] as const,
  mission: (id: string) => ['missions', 'detail', id] as const,
};

export function useOrderStaffing(orderId: string, enabled = true): UseQueryResult<OrderStaffing> {
  return useQuery({
    queryKey: assignmentKeys.staffing(orderId),
    queryFn: ({ signal }) =>
      apiRequest(`/orders/${orderId}/staffing`, { schema: orderStaffingSchema, signal }),
    enabled,
  });
}

/** Écritures sur le personnel d'une commande : la commande (alerte) et le planning suivent. */
function useStaffingMutation<TVariables>(
  orderId: string,
  mutationFn: (variables: TVariables) => Promise<OrderStaffing>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (staffing) => {
      queryClient.setQueryData(assignmentKeys.staffing(orderId), staffing);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orderKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['staff', 'planning'] }),
      ]);
    },
  });
}

/** Plusieurs membres en une transaction (409 ASSIGNMENT_BATCH_CONFLICT : problème par ligne). */
export function useCreateAssignments(orderId: string) {
  return useStaffingMutation(orderId, (input: AssignmentBatchInput) =>
    apiRequest(`/orders/${orderId}/assignments/batch`, {
      method: 'POST',
      body: input,
      schema: orderStaffingSchema,
    }),
  );
}

export function useUpdateAssignment(orderId: string) {
  return useStaffingMutation(
    orderId,
    ({ id, input }: { id: string; input: AssignmentUpdateInput }) =>
      apiRequest(`/assignments/${id}`, { method: 'PUT', body: input, schema: orderStaffingSchema }),
  );
}

export function useRemoveAssignment(orderId: string) {
  return useStaffingMutation(orderId, (id: string) =>
    apiRequest(`/assignments/${id}`, { method: 'DELETE', schema: orderStaffingSchema }),
  );
}

export function useUpdateServiceInfo(orderId: string) {
  return useStaffingMutation(orderId, (input: ServiceInfoInput) =>
    apiRequest(`/orders/${orderId}/service-info`, {
      method: 'PUT',
      body: input,
      schema: orderStaffingSchema,
    }),
  );
}

export function usePlanning(week: string): UseQueryResult<Planning> {
  return useQuery({
    queryKey: assignmentKeys.planning(week),
    queryFn: ({ signal }) =>
      apiRequest('/assignments/planning', { query: { week }, schema: planningSchema, signal }),
  });
}

// ─────────────────────────── Missions (équipe, livreur) ───────────────────────────

export function useMissions(scope: MissionListQuery['scope']): UseQueryResult<MissionSummary[]> {
  return useQuery({
    queryKey: assignmentKeys.missions(scope),
    queryFn: ({ signal }) =>
      apiRequest('/me/missions', {
        query: { scope },
        schema: z.array(missionSummarySchema),
        signal,
      }),
  });
}

export function useMission(id: string): UseQueryResult<Mission> {
  return useQuery({
    queryKey: assignmentKeys.mission(id),
    queryFn: ({ signal }) => apiRequest(`/me/missions/${id}`, { schema: missionSchema, signal }),
  });
}

export function useMissionAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'confirm' }
        | { kind: 'done' }
        | { kind: 'decline'; reason: string }
        | { kind: 'delivery'; to: 'OUT_FOR_DELIVERY' | 'DELIVERED' },
    ) => {
      const path = `/me/missions/${id}/${action.kind}`;
      const body =
        action.kind === 'decline'
          ? { reason: action.reason }
          : action.kind === 'delivery'
            ? { to: action.to }
            : undefined;
      return apiRequest(path, { method: 'POST', body, schema: missionSchema });
    },
    onSuccess: async (mission) => {
      queryClient.setQueryData(assignmentKeys.mission(id), mission);
      await queryClient.invalidateQueries({ queryKey: ['missions', 'list'] });
    },
  });
}

/** « Encaissé » : montant, mode, n° de chèque et photo facultative (multipart). */
export function useMissionCollect(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      amount: number;
      method: CollectionMethod;
      reference: string | null;
      photo: File | null;
    }) => {
      const form = new FormData();
      form.append('amount', String(input.amount));
      form.append('method', input.method);
      if (input.reference) form.append('reference', input.reference);
      if (input.photo) form.append('photo', input.photo);
      return apiRequest(`/me/missions/${id}/collect`, {
        method: 'POST',
        body: form,
        schema: missionSchema,
      });
    },
    onSuccess: (mission) => queryClient.setQueryData(assignmentKeys.mission(id), mission),
  });
}
