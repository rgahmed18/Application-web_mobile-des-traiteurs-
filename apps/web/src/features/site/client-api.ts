'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type ClientAccount,
  type ClientAccountUpdateInput,
  clientAccountSchema,
  type ClientAddress,
  type ClientAddressInput,
  clientAddressSchema,
  type ClientDashboard,
  clientDashboardSchema,
  type ClientInvoice,
  clientInvoiceSchema,
  type ClientOrder,
  clientOrderSchema,
  type ClientOrderSummary,
  clientOrderSummarySchema,
  type ClientPayment,
  clientPaymentSchema,
  type ClientQuoteSummary,
  clientQuoteSummarySchema,
  downloadSchema,
  type PublicQuote,
  publicQuoteSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

import { useClientSession } from './client-session-provider';

/** Clés des requêtes de l'espace client (vidées à la fin de la session avec tout le cache). */
export const clientKeys = {
  all: ['client'] as const,
  account: ['client', 'account'] as const,
  dashboard: ['client', 'dashboard'] as const,
  orders: ['client', 'orders'] as const,
  order: (id: string) => ['client', 'orders', id] as const,
  quotes: ['client', 'quotes'] as const,
  quote: (id: string) => ['client', 'quotes', id] as const,
  invoices: ['client', 'invoices'] as const,
  payments: ['client', 'payments'] as const,
  addresses: ['client', 'addresses'] as const,
};

/** Lecture de l'espace client, seulement une fois la session ouverte. */
function useClientQuery<T>(
  key: readonly unknown[],
  path: string,
  schema: z.ZodType<T>,
): UseQueryResult<T> {
  const session = useClientSession();
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiRequest(path, { schema, signal }),
    enabled: session.status === 'authenticated',
  });
}

export const useClientAccount = () =>
  useClientQuery<ClientAccount>(clientKeys.account, '/client/account', clientAccountSchema);
export const useClientDashboard = () =>
  useClientQuery<ClientDashboard>(clientKeys.dashboard, '/client/dashboard', clientDashboardSchema);
export const useClientOrders = () =>
  useClientQuery<ClientOrderSummary[]>(
    clientKeys.orders,
    '/client/orders',
    z.array(clientOrderSummarySchema),
  );
export const useClientOrder = (id: string) =>
  useClientQuery<ClientOrder>(clientKeys.order(id), `/client/orders/${id}`, clientOrderSchema);
export const useClientQuotes = () =>
  useClientQuery<ClientQuoteSummary[]>(
    clientKeys.quotes,
    '/client/quotes',
    z.array(clientQuoteSummarySchema),
  );
export const useClientQuote = (id: string) =>
  useClientQuery<PublicQuote>(clientKeys.quote(id), `/client/quotes/${id}`, publicQuoteSchema);
export const useClientInvoices = () =>
  useClientQuery<ClientInvoice[]>(
    clientKeys.invoices,
    '/client/invoices',
    z.array(clientInvoiceSchema),
  );
export const useClientPayments = () =>
  useClientQuery<ClientPayment[]>(
    clientKeys.payments,
    '/client/payments',
    z.array(clientPaymentSchema),
  );
export const useClientAddresses = () =>
  useClientQuery<ClientAddress[]>(
    clientKeys.addresses,
    '/client/addresses',
    z.array(clientAddressSchema),
  );

/** Toute action du client rafraîchit son espace (demandes, devis, accueil). */
function useClientMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientKeys.all }),
  });
}

export function useCancelRequest() {
  return useClientMutation((id: string) =>
    apiRequest(`/client/requests/${id}/cancel`, { method: 'POST', schema: z.void() }),
  );
}

export function useUpdateAccount() {
  return useClientMutation((input: ClientAccountUpdateInput) =>
    apiRequest('/client/account', { method: 'PUT', body: input, schema: clientAccountSchema }),
  );
}

export function useSaveAddress() {
  return useClientMutation(({ id, input }: { id: string | null; input: ClientAddressInput }) =>
    apiRequest(id ? `/client/addresses/${id}` : '/client/addresses', {
      method: id ? 'PUT' : 'POST',
      body: input,
      schema: z.array(clientAddressSchema),
    }),
  );
}

export function useRemoveAddress() {
  return useClientMutation((id: string) =>
    apiRequest(`/client/addresses/${id}`, {
      method: 'DELETE',
      schema: z.array(clientAddressSchema),
    }),
  );
}

/** Actions du client sur un devis (même présentation que la page publique). */
export function clientQuoteRespond(id: string) {
  return (action: 'accept' | 'reject', body: object) =>
    apiRequest(`/client/quotes/${id}/${action}`, {
      method: 'POST',
      body,
      schema: publicQuoteSchema,
    });
}

/** PDF (devis, facture, reçu) : lien signé de courte durée, ouvert dans un nouvel onglet. */
export async function openClientDocument(path: string): Promise<void> {
  // Onglet ouvert tout de suite (sinon bloqué par le navigateur après l'attente)
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
