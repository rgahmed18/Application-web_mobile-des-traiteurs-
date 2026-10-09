'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type InvoiceExportQuery,
  type InvoiceKind,
  type InvoiceListQuery,
  type InvoicePage,
  invoicePageSchema,
  type OrderInvoicing,
  orderInvoicingSchema,
} from '@traiteur/shared';

import { orderKeys } from '@/features/orders/orders-api';
import { apiRequest, downloadFile } from '@/lib/api/client';

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (query: Partial<InvoiceListQuery>) => ['invoices', 'list', query] as const,
  order: (orderId: string) => ['orders', 'invoices', orderId] as const,
};

export function useOrderInvoicing(orderId: string, enabled = true): UseQueryResult<OrderInvoicing> {
  return useQuery({
    queryKey: invoiceKeys.order(orderId),
    queryFn: ({ signal }) =>
      apiRequest(`/orders/${orderId}/invoices`, { schema: orderInvoicingSchema, signal }),
    enabled,
  });
}

export function useInvoices(query: Partial<InvoiceListQuery>): UseQueryResult<InvoicePage> {
  return useQuery({
    queryKey: invoiceKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest('/invoices', { query: { ...query }, schema: invoicePageSchema, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Émission ou avoir : la commande, ses factures et la liste des factures sont rafraîchies. */
function useInvoicingMutation<TVariables>(
  orderId: string,
  mutationFn: (variables: TVariables) => Promise<OrderInvoicing>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (state) => {
      queryClient.setQueryData(invoiceKeys.order(orderId), state);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: invoiceKeys.all }),
        queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) }),
      ]);
    },
  });
}

export function useIssueInvoice(orderId: string) {
  return useInvoicingMutation(orderId, (kind: InvoiceKind) =>
    apiRequest(`/orders/${orderId}/invoices`, {
      method: 'POST',
      body: { kind },
      schema: orderInvoicingSchema,
    }),
  );
}

export function useCreditNote(orderId: string) {
  return useInvoicingMutation(orderId, ({ id, reason }: { id: string; reason: string }) =>
    apiRequest(`/invoices/${id}/credit-note`, {
      method: 'POST',
      body: { reason },
      schema: orderInvoicingSchema,
    }),
  );
}

export function exportInvoices(query: InvoiceExportQuery): Promise<void> {
  return downloadFile('/invoices/export', { ...query });
}
