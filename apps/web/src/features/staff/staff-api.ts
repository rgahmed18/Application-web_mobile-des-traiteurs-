'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  invitationLinkSchema,
  type PermissionsMatrix,
  permissionsMatrixSchema,
  type PermissionsUpdateInput,
  type StaffInviteInput,
  staffInviteResultSchema,
  type StaffListQuery,
  type StaffMember,
  type StaffMemberRole,
  staffMemberSchema,
  type StaffSuspendInput,
  type StaffUpdateInput,
} from '@traiteur/shared';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

export const staffKeys = {
  all: ['staff'] as const,
  list: (query: StaffListQuery) => ['staff', 'list', query] as const,
  permissions: ['staff', 'permissions'] as const,
};

export function useStaff(query: StaffListQuery = {}): UseQueryResult<StaffMember[]> {
  return useQuery({
    queryKey: staffKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest('/staff', { query: { ...query }, schema: z.array(staffMemberSchema), signal }),
  });
}

function useStaffMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: staffKeys.all }),
  });
}

export function useInviteMember() {
  return useStaffMutation((input: StaffInviteInput) =>
    apiRequest('/staff/invitations', {
      method: 'POST',
      body: input,
      schema: staffInviteResultSchema,
    }),
  );
}

export function useRenewInvitation() {
  return useStaffMutation((id: string) =>
    apiRequest(`/staff/${id}/invitation`, { method: 'POST', schema: staffInviteResultSchema }),
  );
}

export function useCancelInvitation() {
  return useStaffMutation((id: string) =>
    apiRequest(`/staff/${id}/invitation`, { method: 'DELETE', schema: z.void() }),
  );
}

export function useUpdateMember() {
  return useStaffMutation(({ id, input }: { id: string; input: StaffUpdateInput }) =>
    apiRequest(`/staff/${id}`, { method: 'PUT', body: input, schema: staffMemberSchema }),
  );
}

export function useSuspendMember() {
  return useStaffMutation(({ id, input }: { id: string; input: StaffSuspendInput }) =>
    apiRequest(`/staff/${id}/suspend`, { method: 'POST', body: input, schema: staffMemberSchema }),
  );
}

export function useReactivateMember() {
  return useStaffMutation((id: string) =>
    apiRequest(`/staff/${id}/reactivate`, {
      method: 'POST',
      schema: z.object({ member: staffMemberSchema, link: invitationLinkSchema.nullable() }),
    }),
  );
}

export function usePermissionsMatrix(enabled = true): UseQueryResult<PermissionsMatrix> {
  return useQuery({
    queryKey: staffKeys.permissions,
    queryFn: ({ signal }) =>
      apiRequest('/settings/permissions', { schema: permissionsMatrixSchema, signal }),
    enabled,
  });
}

export function useUpdatePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PermissionsUpdateInput) =>
      apiRequest('/settings/permissions', {
        method: 'PUT',
        body: input,
        schema: permissionsMatrixSchema,
      }),
    onSuccess: (matrix) => queryClient.setQueryData(staffKeys.permissions, matrix),
  });
}

export function useResetPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: StaffMemberRole | null) =>
      apiRequest('/settings/permissions/reset', {
        method: 'POST',
        body: { role },
        schema: permissionsMatrixSchema,
      }),
    onSuccess: (matrix) => queryClient.setQueryData(staffKeys.permissions, matrix),
  });
}
