'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type DepositUpdateInput,
  downloadSchema,
  type OrderPayments,
  orderPaymentsSchema,
  type PaymentInput,
  type RefundInput,
  type VoidPaymentInput,
} from '@traiteur/shared';

import { orderKeys } from '@/features/orders/orders-api';
import { apiRequest } from '@/lib/api/client';

export const paymentKeys = {
  order: (orderId: string) => ['orders', 'payments', orderId] as const,
};

export function useOrderPayments(orderId: string, enabled = true): UseQueryResult<OrderPayments> {
  return useQuery({
    queryKey: paymentKeys.order(orderId),
    queryFn: ({ signal }) =>
      apiRequest(`/orders/${orderId}/payments`, { schema: orderPaymentsSchema, signal }),
    enabled,
  });
}

/** Toute écriture rafraîchit l'échéancier, la commande, les listes et le tableau de bord. */
function usePaymentMutation<TVariables>(
  orderId: string,
  mutationFn: (variables: TVariables) => Promise<OrderPayments>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (state) => {
      queryClient.setQueryData(paymentKeys.order(orderId), state);
      return queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useRecordPayment(orderId: string) {
  return usePaymentMutation(orderId, (input: PaymentInput) =>
    apiRequest(`/orders/${orderId}/payments`, {
      method: 'POST',
      body: input,
      schema: orderPaymentsSchema,
    }),
  );
}

export function useRefund(orderId: string) {
  return usePaymentMutation(orderId, (input: RefundInput) =>
    apiRequest(`/orders/${orderId}/refunds`, {
      method: 'POST',
      body: input,
      schema: orderPaymentsSchema,
    }),
  );
}

export function useVoidPayment(orderId: string) {
  return usePaymentMutation(
    orderId,
    ({ paymentId, input }: { paymentId: string; input: VoidPaymentInput }) =>
      apiRequest(`/orders/${orderId}/payments/${paymentId}/void`, {
        method: 'POST',
        body: input,
        schema: orderPaymentsSchema,
      }),
  );
}

export function useSetDeposit(orderId: string) {
  return usePaymentMutation(orderId, (input: DepositUpdateInput) =>
    apiRequest(`/orders/${orderId}/deposit`, {
      method: 'PUT',
      body: input,
      schema: orderPaymentsSchema,
    }),
  );
}

/** Ouvre un document PDF (URL signée de quelques minutes) dans un nouvel onglet. */
export async function openDocument(path: string): Promise<void> {
  // Onglet ouvert tout de suite (geste de l'utilisateur), rempli quand l'URL est prête
  const tab = window.open('', '_blank');
  try {
    const { url } = await apiRequest(path, { schema: downloadSchema });
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
