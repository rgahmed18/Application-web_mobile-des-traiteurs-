'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type Client,
  type ClientAddressInput,
  type ClientCreateInput,
  type ClientListQuery,
  type ClientPage,
  clientPageSchema,
  clientSchema,
  type ClientUpdateInput,
} from '@traiteur/shared';

import { apiRequest } from '@/lib/api/client';
import { toQuery } from '@/lib/api/query';

export const clientKeys = {
  all: ['clients'] as const,
  list: (query: Partial<ClientListQuery>) => ['clients', 'list', query] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
};

export function useClients(
  query: Partial<ClientListQuery>,
  enabled = true,
): UseQueryResult<ClientPage> {
  return useQuery({
    queryKey: clientKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest('/clients', { query: toQuery(query), schema: clientPageSchema, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useClient(id: string | null): UseQueryResult<Client> {
  return useQuery({
    queryKey: clientKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest(`/clients/${id ?? ''}`, { schema: clientSchema, signal }),
    enabled: id !== null,
  });
}

/** Toute écriture sur un client rafraîchit les listes et sa fiche (et les commandes affichées). */
function useClientMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<Client>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (client) => {
      queryClient.setQueryData(clientKeys.detail(client.id), client);
      return queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useCreateClient() {
  return useClientMutation((input: ClientCreateInput) =>
    apiRequest('/clients', { method: 'POST', body: input, schema: clientSchema }),
  );
}

export function useUpdateClient() {
  return useClientMutation(({ id, input }: { id: string; input: ClientUpdateInput }) =>
    apiRequest(`/clients/${id}`, { method: 'PUT', body: input, schema: clientSchema }),
  );
}

export function useSaveAddress() {
  return useClientMutation(
    ({
      clientId,
      addressId,
      input,
    }: {
      clientId: string;
      addressId: string | null;
      input: ClientAddressInput;
    }) =>
      apiRequest(
        addressId
          ? `/clients/${clientId}/addresses/${addressId}`
          : `/clients/${clientId}/addresses`,
        { method: addressId ? 'PATCH' : 'POST', body: input, schema: clientSchema },
      ),
  );
}

export function useRemoveAddress() {
  return useClientMutation(({ clientId, addressId }: { clientId: string; addressId: string }) =>
    apiRequest(`/clients/${clientId}/addresses/${addressId}`, {
      method: 'DELETE',
      schema: clientSchema,
    }),
  );
}

/** « Nadia Idrissi » */
export function clientName(client: { firstName: string; lastName: string }): string {
  return `${client.firstName} ${client.lastName}`.trim();
}
