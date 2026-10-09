'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type Availability,
  availabilitySchema,
  type BlockedDateInput,
  type Calendar,
  type CalendarQuery,
  calendarSchema,
  type CapacityInput,
  type Dashboard,
  dashboardSchema,
  type Order,
  type OrderCreateInput,
  type OrderHistoryEntry,
  orderHistoryEntrySchema,
  type OrderListQuery,
  type OrderPage,
  orderPageSchema,
  orderSchema,
  type OrderTransitionInput,
  type OrderUpdateInput,
} from '@traiteur/shared';
import { z } from 'zod';

import { clientKeys } from '@/features/clients/clients-api';
import { apiRequest } from '@/lib/api/client';
import { toQuery } from '@/lib/api/query';

/** Toute écriture sur une commande invalide ['orders'] (listes, calendrier, tableau de bord). */
export const orderKeys = {
  all: ['orders'] as const,
  list: (query: Partial<OrderListQuery>) => ['orders', 'list', query] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  history: (id: string) => ['orders', 'history', id] as const,
  availability: (date: string, excludeOrderId?: string) =>
    ['orders', 'availability', date, excludeOrderId ?? null] as const,
  calendar: (query: CalendarQuery) => ['orders', 'calendar', query] as const,
  dashboard: ['orders', 'dashboard'] as const,
};

export function useOrders(
  query: Partial<OrderListQuery>,
  enabled = true,
): UseQueryResult<OrderPage> {
  return useQuery({
    queryKey: orderKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest('/orders', { query: toQuery(query), schema: orderPageSchema, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useOrder(id: string | null): UseQueryResult<Order> {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest(`/orders/${id ?? ''}`, { schema: orderSchema, signal }),
    enabled: id !== null,
  });
}

export function useOrderHistory(id: string): UseQueryResult<OrderHistoryEntry[]> {
  return useQuery({
    queryKey: orderKeys.history(id),
    queryFn: ({ signal }) =>
      apiRequest(`/orders/${id}/history`, { schema: z.array(orderHistoryEntrySchema), signal }),
  });
}

export function useAvailability(
  date: string | null,
  excludeOrderId?: string,
): UseQueryResult<Availability> {
  return useQuery({
    queryKey: orderKeys.availability(date ?? '', excludeOrderId),
    queryFn: ({ signal }) =>
      apiRequest('/orders/availability', {
        query: toQuery({ date, excludeOrderId }),
        schema: availabilitySchema,
        signal,
      }),
    enabled: date !== null,
  });
}

export function useCalendar(query: CalendarQuery): UseQueryResult<Calendar> {
  return useQuery({
    queryKey: orderKeys.calendar(query),
    queryFn: ({ signal }) =>
      apiRequest('/calendar', { query: toQuery(query), schema: calendarSchema, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDashboard(enabled: boolean): UseQueryResult<Dashboard> {
  return useQuery({
    queryKey: orderKeys.dashboard,
    queryFn: ({ signal }) => apiRequest('/dashboard', { schema: dashboardSchema, signal }),
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

function useOrderMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<Order>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      return queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useCreateOrder() {
  return useOrderMutation((input: OrderCreateInput) =>
    apiRequest('/orders', { method: 'POST', body: input, schema: orderSchema }),
  );
}

export function useUpdateOrder() {
  return useOrderMutation(({ id, input }: { id: string; input: OrderUpdateInput }) =>
    apiRequest(`/orders/${id}`, { method: 'PUT', body: input, schema: orderSchema }),
  );
}

export function useTransitionOrder() {
  return useOrderMutation(({ id, input }: { id: string; input: OrderTransitionInput }) =>
    apiRequest(`/orders/${id}/transitions`, { method: 'POST', body: input, schema: orderSchema }),
  );
}

function useCalendarMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useBlockDate() {
  return useCalendarMutation((input: BlockedDateInput) =>
    apiRequest('/calendar/blocked-dates', { method: 'POST', body: input, schema: z.void() }),
  );
}

export function useUnblockDate() {
  return useCalendarMutation((date: string) =>
    apiRequest(`/calendar/blocked-dates/${date}`, { method: 'DELETE', schema: z.void() }),
  );
}

export function useSetCapacity() {
  return useCalendarMutation((input: CapacityInput) =>
    apiRequest('/calendar/capacity', { method: 'PUT', body: input, schema: z.void() }),
  );
}
