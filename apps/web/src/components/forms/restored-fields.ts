'use client';

import { createContext, useContext } from 'react';

/**
 * Formulaire rempli depuis un brouillon repris : chaque FormField dont la valeur vient du
 * brouillon (modifiée, pas encore touchée) le signale (voir features/drafts/draft-fields.tsx).
 */
export const RestoredFieldsContext = createContext(false);

export function useRestoredFields(): boolean {
  return useContext(RestoredFieldsContext);
}
