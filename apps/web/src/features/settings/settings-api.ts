'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type BillingSettings,
  type BillingSettingsInput,
  billingSettingsSchema,
} from '@traiteur/shared';

import { apiRequest, uploadFile } from '@/lib/api/client';

const billingKey = ['settings', 'billing'] as const;

export function useBillingSettings(): UseQueryResult<BillingSettings> {
  return useQuery({
    queryKey: billingKey,
    queryFn: ({ signal }) =>
      apiRequest('/settings/billing', { schema: billingSettingsSchema, signal }),
  });
}

function useBillingMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<BillingSettings>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (settings) => queryClient.setQueryData(billingKey, settings),
  });
}

export function useSaveBillingSettings() {
  return useBillingMutation((input: BillingSettingsInput) =>
    apiRequest('/settings/billing', { method: 'PUT', body: input, schema: billingSettingsSchema }),
  );
}

export function useUploadLogo() {
  return useBillingMutation((file: File) =>
    uploadFile('/settings/billing/logo', file, billingSettingsSchema),
  );
}

export function useRemoveLogo() {
  return useBillingMutation(() =>
    apiRequest('/settings/billing/logo', { method: 'DELETE', schema: billingSettingsSchema }),
  );
}
