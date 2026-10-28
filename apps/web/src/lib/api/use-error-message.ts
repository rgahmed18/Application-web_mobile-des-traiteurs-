'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useSpace } from '@/features/space/space-provider';

import { errorMessageKey } from './errors';

/** Message clair et traduit pour n'importe quelle erreur (API, réseau, inattendue). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  const space = useSpace();
  return useCallback(
    (error: unknown) => {
      const key = errorMessageKey(error);
      // Accès refusé : on nomme l'espace de l'adresse (jamais un autre traiteur)
      if (key === 'api.NO_BACKOFFICE_ACCESS' && space) {
        return space.kind === 'traiteur'
          ? t('noBackofficeAccessTraiteur', { name: space.traiteur.name })
          : t('noBackofficeAccessPlatform');
      }
      return t(key);
    },
    [space, t],
  );
}
