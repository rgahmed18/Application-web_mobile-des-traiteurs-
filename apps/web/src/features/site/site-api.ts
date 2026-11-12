'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
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
