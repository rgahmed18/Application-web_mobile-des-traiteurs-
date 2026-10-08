'use client';

import type { PermissionKey } from '@traiteur/shared';
import { type ReactNode, useCallback, useEffect, useSyncExternalStore } from 'react';

import { hasPermission, sessionStore, type SessionState } from './session-store';

/** Démarre la restauration de session au premier rendu côté navigateur. */
export function SessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    sessionStore.restore();
  }, []);
  return children;
}

export function useSession(): SessionState {
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
}

/** Teste une permission pour l'utilisateur courant (le menu et les pages s'y adaptent). */
export function usePermission(): (permission: PermissionKey) => boolean {
  const session = useSession();
  return useCallback((permission: PermissionKey) => hasPermission(session, permission), [session]);
}
