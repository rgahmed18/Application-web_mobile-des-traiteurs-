'use client';

import type { Space } from '@traiteur/shared';
import { createContext, type ReactNode, useContext } from 'react';

/**
 * Espace servi par l'adresse, résolu par le serveur (layout racine) : console de la plateforme
 * ou back-office d'un traiteur. Lu par la page de connexion (nom, logo, message d'accès refusé).
 */
const SpaceContext = createContext<Space | null>(null);

export function SpaceProvider({ space, children }: { space: Space | null; children: ReactNode }) {
  return <SpaceContext.Provider value={space}>{children}</SpaceContext.Provider>;
}

export function useSpace(): Space | null {
  return useContext(SpaceContext);
}
