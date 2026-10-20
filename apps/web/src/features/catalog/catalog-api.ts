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
  type CatalogList,
  type CatalogListItem,
  type CatalogListItemInput,
  catalogListItemSchema,
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
  list: (list: CatalogList) => ['catalog', 'lists', list] as const,
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

/** Liste gérable (types d'événement, gammes), archivés compris, dans l'ordre d'affichage. */
export function useCatalogList(
  list: CatalogList,
  enabled = true,
): UseQueryResult<CatalogListItem[]> {
  return useQuery({
    queryKey: catalogKeys.list(list),
    queryFn: ({ signal }) =>
      apiRequest(`/catalog/lists/${list}`, { schema: z.array(catalogListItemSchema), signal }),
    staleTime: 60_000,
    enabled,
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

export function useSaveCatalogListItem(list: CatalogList) {
  return useCatalogMutation(({ id, input }: { id: string | null; input: CatalogListItemInput }) =>
    apiRequest(id ? `/catalog/lists/${list}/${id}` : `/catalog/lists/${list}`, {
      method: id ? 'PATCH' : 'POST',
      body: input,
      schema: catalogListItemSchema,
    }),
  );
}

export function useArchiveCatalogListItem(list: CatalogList) {
  return useCatalogMutation(({ id, archived }: { id: string; archived: boolean }) =>
    apiRequest(`/catalog/lists/${list}/${id}/${archived ? 'archive' : 'restore'}`, {
      method: 'POST',
      schema: catalogListItemSchema,
    }),
  );
}

export function useDeleteCatalogListItem(list: CatalogList) {
  return useCatalogMutation((id: string) =>
    apiRequest(`/catalog/lists/${list}/${id}`, { method: 'DELETE', schema: z.void() }),
  );
}

/** Nouvel ordre, appliqué immédiatement à l'écran puis confirmé par l'API. */
export function useReorderCatalogList(list: CatalogList) {
  const queryClient = useQueryClient();
  const key = catalogKeys.list(list);
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest(`/catalog/lists/${list}/order`, {
        method: 'PUT',
        body: { ids },
        schema: z.array(catalogListItemSchema),
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CatalogListItem[]>(key);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        queryClient.setQueryData(
          key,
          ids.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
