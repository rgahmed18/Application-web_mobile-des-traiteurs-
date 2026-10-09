'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type Quote,
  type QuoteCreateInput,
  quoteLinkSchema,
  quoteSchema,
  quoteSendResultSchema,
  type QuoteUpdateInput,
} from '@traiteur/shared';
import { z } from 'zod';

import { orderKeys } from '@/features/orders/orders-api';
import { apiRequest } from '@/lib/api/client';

export const quoteKeys = {
  order: (orderId: string) => ['orders', 'quotes', orderId] as const,
};

export function useOrderQuotes(orderId: string, enabled = true): UseQueryResult<Quote[]> {
  return useQuery({
    queryKey: quoteKeys.order(orderId),
    queryFn: ({ signal }) =>
      apiRequest(`/orders/${orderId}/quotes`, { schema: z.array(quoteSchema), signal }),
    enabled,
  });
}

/**
 * Toute action sur un devis peut changer la commande (statut, acompte) : on rafraîchit les
 * devis, la commande, son historique, les listes et le tableau de bord.
 */
function useQuoteMutation<TVariables, TResult>(
  orderId: string,
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useCreateQuote(orderId: string) {
  return useQuoteMutation(orderId, (input: Partial<QuoteCreateInput>) =>
    apiRequest(`/orders/${orderId}/quotes`, { method: 'POST', body: input, schema: quoteSchema }),
  );
}

export function useUpdateQuote(orderId: string) {
  return useQuoteMutation(orderId, ({ id, input }: { id: string; input: QuoteUpdateInput }) =>
    apiRequest(`/quotes/${id}`, { method: 'PATCH', body: input, schema: quoteSchema }),
  );
}

export function useSendQuote(orderId: string) {
  return useQuoteMutation(orderId, (id: string) =>
    apiRequest(`/quotes/${id}/send`, { method: 'POST', schema: quoteSendResultSchema }),
  );
}

export function useRenewQuoteLink(orderId: string) {
  return useQuoteMutation(orderId, (id: string) =>
    apiRequest(`/quotes/${id}/link`, { method: 'POST', schema: quoteLinkSchema }),
  );
}

export function useRevokeQuoteLink(orderId: string) {
  return useQuoteMutation(orderId, (id: string) =>
    apiRequest(`/quotes/${id}/revoke-link`, { method: 'POST', schema: quoteSchema }),
  );
}

export interface ManualAcceptance {
  id: string;
  name: string;
  mode: 'PHONE' | 'PAPER' | 'OTHER';
  note: string;
  file: File | null;
}

/** Accord enregistré par le traiteur, avec la pièce jointe facultative (multipart). */
export function useAcceptQuoteManually(orderId: string) {
  return useQuoteMutation(orderId, ({ id, name, mode, note, file }: ManualAcceptance) => {
    const body = new FormData();
    body.set('name', name);
    body.set('mode', mode);
    if (note.trim() !== '') body.set('note', note.trim());
    if (file) body.set('file', file);
    return apiRequest(`/quotes/${id}/accept`, { method: 'POST', body, schema: quoteSchema });
  });
}
