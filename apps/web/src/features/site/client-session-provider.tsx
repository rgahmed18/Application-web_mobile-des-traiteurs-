'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

import { clientSessionStore, type ClientSessionState } from './client-session-store';

/** Site client : reprend la session du client au premier rendu dans le navigateur. */
export function ClientSessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    clientSessionStore.restore();
  }, []);
  return children;
}

export function useClientSession(): ClientSessionState {
  return useSyncExternalStore(
    clientSessionStore.subscribe,
    clientSessionStore.getSnapshot,
    clientSessionStore.getServerSnapshot,
  );
}
