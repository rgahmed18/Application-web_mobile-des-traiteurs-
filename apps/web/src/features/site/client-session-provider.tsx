'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

import { cartStore } from './cart-store';
import { clientSessionStore, type ClientSessionState } from './client-session-store';
import { useSiteSlug } from './site-api';

/**
 * Site client : reprend la session du client au premier rendu dans le navigateur, relit « ma
 * demande » de ce traiteur et la vide à la fin de la session (déconnexion, autre onglet).
 */
export function ClientSessionProvider({ children }: { children: ReactNode }) {
  const slug = useSiteSlug();
  useEffect(() => {
    cartStore.open(slug);
    clientSessionStore.restore();
    return clientSessionStore.onEnd(() => cartStore.clear());
  }, [slug]);
  return children;
}

export function useClientSession(): ClientSessionState {
  return useSyncExternalStore(
    clientSessionStore.subscribe,
    clientSessionStore.getSnapshot,
    clientSessionStore.getServerSnapshot,
  );
}
