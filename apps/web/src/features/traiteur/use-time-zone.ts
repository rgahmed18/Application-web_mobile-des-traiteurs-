'use client';

import { useCatalogSettings } from '@/features/catalog/catalog-api';
import { DEFAULT_TIME_ZONE } from '@/lib/format/date';

/** Fuseau du traiteur (dates et heures affichées), Casablanca tant qu'il n'est pas chargé. */
export function useTimeZone(): string {
  return useCatalogSettings().data?.timezone ?? DEFAULT_TIME_ZONE;
}
