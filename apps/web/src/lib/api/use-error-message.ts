'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { errorMessageKey } from './errors';

/** Message clair et traduit pour n'importe quelle erreur (API, réseau, inattendue). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback((error: unknown) => t(errorMessageKey(error)), [t]);
}
