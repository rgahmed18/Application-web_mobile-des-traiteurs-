import {
  type AuthContext,
  authSessionSchema,
  type AuthUser,
  type ClientCodeRequestInput,
  type ClientCodeResponse,
  clientCodeResponseSchema,
  type ClientVerifyInput,
  meSchema,
} from '@traiteur/shared';
import { z } from 'zod';

import { apiRequest, configureApiAuth, sessionRequest } from '@/lib/api/client';

/**
 * Session du site client, en mémoire uniquement (comme celle du back-office) : l'access token
 * n'est jamais écrit dans le stockage du navigateur ; au rechargement, la session est reprise
 * par /api/client-session/refresh grâce au cookie httpOnly du site client.
 */
export type ClientSessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface ClientSessionState {
  status: ClientSessionStatus;
  user: AuthUser | null;
  context: AuthContext | null;
}

const BASE = '/api/client-session';
const clientSessionSchema = authSessionSchema.omit({ refreshToken: true });
type ClientSession = z.infer<typeof clientSessionSchema>;

const INITIAL_STATE: ClientSessionState = { status: 'loading', user: null, context: null };
/** Rafraîchissement anticipé, avant l'expiration du jeton. */
const REFRESH_MARGIN_MS = 60_000;

let state: ClientSessionState = INITIAL_STATE;
let accessToken: string | null = null;
let expiresAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let restoreStarted = false;
const listeners = new Set<() => void>();
/** Fin de session (ici ou dans un autre onglet) : vider ce qui ne doit pas survivre (panier). */
const endHooks = new Set<() => void>();

function setState(patch: Partial<ClientSessionState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

// Onglets du même site : une déconnexion ici termine la session dans les autres
type TabMessage = { type: 'ended' } | { type: 'started' };
let channel: BroadcastChannel | null = null;
function tabs(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel('gt-client-session');
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === 'ended' && state.status === 'authenticated') clearSession();
      if (type === 'started' && state.status !== 'authenticated') void refreshAccessToken();
    };
  }
  return channel;
}
function post(message: TabMessage): void {
  tabs()?.postMessage(message);
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(5_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => void refreshAccessToken(), delay);
}

function clearSession(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  accessToken = null;
  expiresAt = 0;
  // Fin d'une session ouverte (pas un simple visiteur au chargement de la page)
  if (state.status === 'authenticated') for (const hook of endHooks) hook();
  setState({ status: 'anonymous', user: null, context: null });
}

async function applySession(session: ClientSession): Promise<void> {
  accessToken = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
  scheduleRefresh();
  const me = await apiRequest('/auth/me', { schema: meSchema, accessToken: session.accessToken });
  const wasAnonymous = state.status !== 'authenticated';
  setState({ status: 'authenticated', user: me.user, context: me.context });
  if (wasAnonymous) post({ type: 'started' });
}

/** Une seule rotation à la fois dans tout le navigateur (réutilisation = famille révoquée). */
function acrossTabs<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request('gt-client-session-refresh', task);
  }
  return task();
}

function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const session = await acrossTabs(() =>
        sessionRequest('/refresh', clientSessionSchema, {}, null, BASE),
      );
      await applySession(session);
      return accessToken;
    } catch {
      const wasAuthenticated = state.status === 'authenticated';
      clearSession();
      if (wasAuthenticated) post({ type: 'ended' });
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function getAccessToken(): Promise<string | null> {
  if (!accessToken) return refreshInFlight ? refreshInFlight : null;
  if (Date.now() > expiresAt - 10_000) return refreshAccessToken();
  return accessToken;
}

/** Branche le client HTTP sur cette session (le site client ne charge jamais celle du back-office). */
export function bindClientApiAuth(): void {
  configureApiAuth({ getAccessToken, refreshAccessToken });
}

export const clientSessionStore = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): ClientSessionState => state,
  getServerSnapshot: (): ClientSessionState => INITIAL_STATE,

  /** Au chargement du site : reprend la session si le cookie du site client est valide. */
  restore(): void {
    bindClientApiAuth();
    if (restoreStarted) return;
    restoreStarted = true;
    tabs();
    // Onglet de nouveau visible : la session a pu se terminer ailleurs
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.status === 'authenticated') {
        void getAccessToken();
      }
    });
    void refreshAccessToken();
  },

  /** Fin de session (déconnexion, expiration, autre onglet) : vider le panier, par exemple. */
  onEnd(hook: () => void): () => void {
    endHooks.add(hook);
    return () => endHooks.delete(hook);
  },

  requestCode(input: ClientCodeRequestInput): Promise<ClientCodeResponse> {
    return sessionRequest('/code', clientCodeResponseSchema, input, null, BASE);
  },

  /** Code vérifié : session ouverte ; sinon l'erreur de l'API (SIGNUP_REQUIRED…) est levée. */
  async verify(input: ClientVerifyInput): Promise<void> {
    await applySession(await sessionRequest('/verify', clientSessionSchema, input, null, BASE));
  },

  async logout(): Promise<void> {
    try {
      await sessionRequest('/logout', z.void(), {}, null, BASE);
    } finally {
      clearSession();
      post({ type: 'ended' });
    }
  },
};
