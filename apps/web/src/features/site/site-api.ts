'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  type PublicCatalog,
  type PublicCatalogOptions,
  publicCatalogOptionsSchema,
  type PublicCatalogQuery,
  publicCatalogSchema,
  type PublicPrivacy,
  publicPrivacySchema,
  type PublicSite,
  publicSiteSchema,
} from '@traiteur/shared';

import { useSpace } from '@/features/space/space-provider';
import { apiRequest } from '@/lib/api/client';

/** Identifiant du traiteur de l'adresse (le site client n'existe que sur l'adresse d'un traiteur). */
export function useSiteSlug(): string {
  const space = useSpace();
  return space?.kind === 'traiteur' ? space.traiteur.slug : '-';
}

export function usePublicSite(): UseQueryResult<PublicSite> {
  const slug = useSiteSlug();
  return useQuery({
    queryKey: ['public-site', slug],
    queryFn: ({ signal }) =>
      apiRequest(`/public/traiteurs/${slug}/site`, { schema: publicSiteSchema, signal }),
  });
}

/** Politique de confidentialité en vigueur (et sa version, enregistrée avec le consentement). */
export function usePublicPrivacy(): UseQueryResult<PublicPrivacy> {
  const slug = useSiteSlug();
  return useQuery({
    queryKey: ['public-privacy', slug],
    queryFn: ({ signal }) =>
      apiRequest(`/public/traiteurs/${slug}/privacy`, { schema: publicPrivacySchema, signal }),
  });
}

/** Types d'événement et gammes proposés par le traiteur (filtres du catalogue). */
export function usePublicCatalogOptions(): UseQueryResult<PublicCatalogOptions> {
  const slug = useSiteSlug();
  return useQuery({
    queryKey: ['public-catalog-options', slug],
    queryFn: ({ signal }) =>
      apiRequest(`/public/traiteurs/${slug}/catalog/options`, {
        schema: publicCatalogOptionsSchema,
        signal,
      }),
  });
}

/** Catalogue publié (prix TTC), filtré par type d'événement et gamme. */
export function usePublicCatalog(filters: PublicCatalogQuery = {}): UseQueryResult<PublicCatalog> {
  const slug = useSiteSlug();
  return useQuery({
    queryKey: ['public-catalog', slug, filters.eventType ?? null, filters.range ?? null],
    queryFn: ({ signal }) =>
      apiRequest(`/public/traiteurs/${slug}/catalog`, {
        schema: publicCatalogSchema,
        query: { eventType: filters.eventType, range: filters.range },
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}
