'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type CatalogSettings,
  catalogSettingsSchema,
  type Category,
  type CategoryInput,
  categorySchema,
  type Dish,
  type DishInput,
  type DishListQuery,
  type DishPage,
  dishPageSchema,
  dishSchema,
  type ExtraService,
  type ExtraServiceInput,
  extraServiceSchema,
  type Package,
  type PackageInput,
  type PackageListQuery,
  type PackagePage,
  packagePageSchema,
  packageSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import { apiRequest, type QueryValue } from '@/lib/api/client';

/** Clés de cache : toute modification du catalogue invalide ['catalog']. */
export const catalogKeys = {
  all: ['catalog'] as const,
  settings: ['catalog', 'settings'] as const,
  categories: ['catalog', 'categories'] as const,
  dishes: (query: Partial<DishListQuery>) => ['catalog', 'dishes', query] as const,
  dish: (id: string) => ['catalog', 'dish', id] as const,
  packages: (query: Partial<PackageListQuery>) => ['catalog', 'packages', query] as const,
  package: (id: string) => ['catalog', 'package', id] as const,
  services: (archived: boolean) => ['catalog', 'services', archived] as const,
};

function toQuery(values: object): Record<string, QueryValue> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

// ─────────────────────────── Lectures ───────────────────────────

/** Mode de saisie des prix (HT / TTC) et TVA : rarement modifiés, gardés 5 minutes. */
export function useCatalogSettings(): UseQueryResult<CatalogSettings> {
  return useQuery({
    queryKey: catalogKeys.settings,
    queryFn: ({ signal }) =>
      apiRequest('/catalog/settings', { schema: catalogSettingsSchema, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: ({ signal }) =>
      apiRequest('/catalog/categories', { schema: z.array(categorySchema), signal }),
  });
}

export function useDishes(query: Partial<DishListQuery>): UseQueryResult<DishPage> {
  return useQuery({
    queryKey: catalogKeys.dishes(query),
    queryFn: ({ signal }) =>
      apiRequest('/catalog/dishes', { query: toQuery(query), schema: dishPageSchema, signal }),
    placeholderData: keepPreviousData, // pas de clignotement en changeant de page
  });
}

export function useDish(id: string | null): UseQueryResult<Dish> {
  return useQuery({
    queryKey: catalogKeys.dish(id ?? ''),
    queryFn: ({ signal }) =>
      apiRequest(`/catalog/dishes/${id ?? ''}`, { schema: dishSchema, signal }),
    enabled: id !== null,
  });
}

export function usePackages(query: Partial<PackageListQuery>): UseQueryResult<PackagePage> {
  return useQuery({
    queryKey: catalogKeys.packages(query),
    queryFn: ({ signal }) =>
      apiRequest('/catalog/packages', { query: toQuery(query), schema: packagePageSchema, signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePackage(id: string | null): UseQueryResult<Package> {
  return useQuery({
    queryKey: catalogKeys.package(id ?? ''),
    queryFn: ({ signal }) =>
      apiRequest(`/catalog/packages/${id ?? ''}`, { schema: packageSchema, signal }),
    enabled: id !== null,
  });
}

export function useExtraServices(archived: boolean): UseQueryResult<ExtraService[]> {
  return useQuery({
    queryKey: catalogKeys.services(archived),
    queryFn: ({ signal }) =>
      apiRequest('/catalog/services', {
        query: { archived: archived ? 'true' : undefined },
        schema: z.array(extraServiceSchema),
        signal,
      }),
  });
}

// ─────────────────────────── Écritures ───────────────────────────

function useCatalogMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  });
}

export function useSaveCategory() {
  return useCatalogMutation(({ id, input }: { id: string | null; input: CategoryInput }) =>
    apiRequest(id ? `/catalog/categories/${id}` : '/catalog/categories', {
      method: id ? 'PATCH' : 'POST',
      body: input,
      schema: categorySchema,
    }),
  );
}

/** Nouvel ordre, appliqué immédiatement à l'écran puis confirmé par l'API. */
export function useReorderCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest('/catalog/categories/order', {
        method: 'PUT',
        body: { ids },
        schema: z.array(categorySchema),
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: catalogKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(catalogKeys.categories);
      if (previous) {
        const byId = new Map(previous.map((category) => [category.id, category]));
        queryClient.setQueryData(
          catalogKeys.categories,
          ids.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(catalogKeys.categories, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogKeys.categories }),
  });
}

export function useSaveDish() {
  return useCatalogMutation(({ id, input }: { id: string | null; input: DishInput }) =>
    apiRequest(id ? `/catalog/dishes/${id}` : '/catalog/dishes', {
      method: id ? 'PUT' : 'POST',
      body: input,
      schema: dishSchema,
    }),
  );
}

export function useSavePackage() {
  return useCatalogMutation(({ id, input }: { id: string | null; input: PackageInput }) =>
    apiRequest(id ? `/catalog/packages/${id}` : '/catalog/packages', {
      method: id ? 'PUT' : 'POST',
      body: input,
      schema: packageSchema,
    }),
  );
}

export function useSaveExtraService() {
  return useCatalogMutation(({ id, input }: { id: string | null; input: ExtraServiceInput }) =>
    apiRequest(id ? `/catalog/services/${id}` : '/catalog/services', {
      method: id ? 'PUT' : 'POST',
      body: input,
      schema: extraServiceSchema,
    }),
  );
}

export type CatalogResource = 'dishes' | 'packages' | 'services';
export type LifecycleAction = 'archive' | 'restore' | 'delete';

/** Archiver, restaurer ou supprimer un plat, une formule ou un service. */
export function useLifecycleAction(resource: CatalogResource) {
  return useCatalogMutation(({ id, action }: { id: string; action: LifecycleAction }) =>
    action === 'delete'
      ? apiRequest(`/catalog/${resource}/${id}`, { method: 'DELETE', schema: z.void() })
      : apiRequest(`/catalog/${resource}/${id}/${action}`, { method: 'POST', schema: z.unknown() }),
  );
}
