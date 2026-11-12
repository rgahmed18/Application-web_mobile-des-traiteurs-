'use client';

import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

import { cartStore } from './cart-store';
import { clientSessionStore, type ClientSessionState } from './client-session-store';
import { useSiteSlug } from './site-api';

/**
 * Site client : reprend la session du client au premier rendu dans le navigateur, relit « ma
 * demande » de ce traiteur et la vide à la fin de la session (déconnexion, autre onglet), avec
 * toutes les données chargées : rien d'un client ne reste pour le suivant sur le même appareil.
 */
export function ClientSessionProvider({ children }: { children: ReactNode }) {
  const slug = useSiteSlug();
  const queryClient = useQueryClient();
  useEffect(() => {
    cartStore.open(slug);
    clientSessionStore.restore();
    return clientSessionStore.onEnd(() => {
      cartStore.clear();
      queryClient.clear();
    });
  }, [slug, queryClient]);
  return children;
}

export function useClientSession(): ClientSessionState {
  return useSyncExternalStore(
    clientSessionStore.subscribe,
    clientSessionStore.getSnapshot,
    clientSessionStore.getServerSnapshot,
  );
}
