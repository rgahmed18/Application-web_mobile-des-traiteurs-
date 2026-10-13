'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type Account,
  accountSchema,
  type AccountUpdateInput,
  type AvailabilitySettings,
  availabilitySettingsSchema,
  type BillingSettings,
  type BillingSettingsInput,
  billingSettingsSchema,
  type CompanySettings,
  companySettingsSchema,
  type PasswordChangeInput,
  type PricingSettingsInput,
  pricingSettingsSchema,
} from '@traiteur/shared';
import { z } from 'zod';

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

// ─────────────────────────── Entreprise, disponibilités, prix ───────────────────────────

/** Lecture et enregistrement d'un réglage (GET / PUT sur le même chemin). */
function settingsResource<TSchema extends z.ZodType>(path: string, schema: TSchema) {
  const key = ['settings', path] as const;
  return {
    useQuery: (): UseQueryResult<z.infer<TSchema>> =>
      useQuery({ queryKey: key, queryFn: ({ signal }) => apiRequest(path, { schema, signal }) }),
    useSave: <TInput>(options: { invalidateAll?: boolean } = {}) => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (input: TInput) => apiRequest(path, { method: 'PUT', body: input, schema }),
        onSuccess: async (saved) => {
          queryClient.setQueryData(key, saved);
          // Calendrier, disponibilité, catalogue : tout ce qui dépend du réglage est relu
          if (options.invalidateAll) await queryClient.invalidateQueries();
        },
      });
    },
  };
}

const company = settingsResource('/settings/company', companySettingsSchema);
const availability = settingsResource('/settings/availability', availabilitySettingsSchema);
const pricing = settingsResource('/settings/pricing', pricingSettingsSchema);
const account = settingsResource('/me/account', accountSchema);

export const useCompanySettings = company.useQuery;
export const useSaveCompanySettings = () => company.useSave<CompanySettings>();
export const useAvailabilitySettings = availability.useQuery;
export const useSaveAvailabilitySettings = () =>
  availability.useSave<AvailabilitySettings>({ invalidateAll: true });
export const usePricingSettings = pricing.useQuery;
export const useSavePricingSettings = () =>
  pricing.useSave<PricingSettingsInput>({ invalidateAll: true });
export const useAccount: () => UseQueryResult<Account> = account.useQuery;
export const useSaveAccount = () => account.useSave<AccountUpdateInput>();

/** Nouveau mot de passe : le serveur ferme toutes les sessions. */
export function changePassword(input: PasswordChangeInput): Promise<void> {
  return apiRequest('/me/account/password', { method: 'POST', body: input, schema: z.void() });
}
