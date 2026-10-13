'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { type CashDesk, cashDeskSchema } from '@traiteur/shared';

import { orderKeys } from '@/features/orders/orders-api';
import { apiRequest } from '@/lib/api/client';

export const cashDeskKeys = { all: ['cash-desk'] as const };

/** Caisse livreurs : encaissements déclarés non encore remis. */
export function useCashDesk(): UseQueryResult<CashDesk> {
  return useQuery({
    queryKey: cashDeskKeys.all,
    queryFn: ({ signal }) => apiRequest('/cash-desk', { schema: cashDeskSchema, signal }),
  });
}

/** Remise (argent récupéré) ou refus : la caisse, les commandes et les encaissements suivent. */
export function useCashDeskAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'remit'; paymentId: string }
        | { kind: 'reject'; paymentId: string; reason: string },
    ) =>
      apiRequest(`/cash-desk/${action.paymentId}/${action.kind}`, {
        method: 'POST',
        body: action.kind === 'reject' ? { reason: action.reason } : undefined,
        schema: cashDeskSchema,
      }),
    onSuccess: async (desk) => {
      queryClient.setQueryData(cashDeskKeys.all, desk);
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}
