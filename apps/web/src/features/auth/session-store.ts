import {
  type AuthContext,
  authSessionSchema,
  type AuthUser,
  meSchema,
  otpRequestResponseSchema,
  type OtpRequestResponse,
  type PermissionKey,
} from '@traiteur/shared';
import { z } from 'zod';

import { apiRequest, configureApiAuth, sessionRequest } from '@/lib/api/client';

/**
 * Session du back-office, en mémoire uniquement.
 * L'access token n'est jamais écrit dans le stockage du navigateur (localStorage, cookie lisible) :
 * une faille XSS ne peut pas le voler durablement. Au rechargement de la page, la session est
 * restaurée par /api/session/refresh grâce au cookie httpOnly.
 */
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';
/** Pourquoi la session s'est terminée : la page de connexion affiche le message adapté. */
export type SessionEndReason = 'logout' | 'expired' | null;

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  context: AuthContext | null;
  permissions: ReadonlySet<string>;
  endReason: SessionEndReason;
}

const clientSessionSchema = authSessionSchema.omit({ refreshToken: true });
type ClientSession = z.infer<typeof clientSessionSchema>;

/** Rafraîchissement anticipé, avant l'expiration du jeton. */
const REFRESH_MARGIN_MS = 60_000;

const INITIAL_STATE: SessionState = {
  status: 'loading',
  user: null,
  context: null,
  permissions: new Set(),
  endReason: null,
};

let state: SessionState = INITIAL_STATE;
let accessToken: string | null = null;
let expiresAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let restoreStarted = false;
const listeners = new Set<() => void>();

function setState(patch: Partial<SessionState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(5_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => void refreshAccessToken(), delay);
}

function clearSession(endReason: SessionEndReason): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  accessToken = null;
  expiresAt = 0;
  setState({ status: 'anonymous', user: null, context: null, permissions: new Set(), endReason });
}

async function applySession(session: ClientSession): Promise<void> {
  accessToken = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
  scheduleRefresh();
  // Permissions effectives lues en base (rôle + surcharges du traiteur)
  const me = await apiRequest('/auth/me', { schema: meSchema, accessToken: session.accessToken });
  setState({
    status: 'authenticated',
    user: me.user,
    context: me.context,
    permissions: new Set(me.permissions),
    endReason: null,
  });
}

/** Rotation du refresh token ; une seule à la fois même si plusieurs requêtes la demandent. */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const session = await sessionRequest('/refresh', clientSessionSchema);
      await applySession(session);
      return accessToken;
    } catch {
      clearSession(state.status === 'authenticated' ? 'expired' : null);
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

configureApiAuth({ getAccessToken, refreshAccessToken });

export const sessionStore = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): SessionState => state,
  getServerSnapshot: (): SessionState => INITIAL_STATE,

  /** Au chargement de l'application : reprend la session si le cookie est valide. */
  restore(): void {
    if (restoreStarted) return;
    restoreStarted = true;
    void refreshAccessToken();
  },

  async loginWithPassword(identifier: string, password: string): Promise<void> {
    await applySession(
      await sessionRequest('/login', clientSessionSchema, { identifier, password }),
    );
  },

  requestOtp(phone: string, purpose: 'LOGIN' | 'PASSWORD_RESET'): Promise<OtpRequestResponse> {
    return sessionRequest('/otp/request', otpRequestResponseSchema, { phone, purpose });
  },

  async loginWithOtp(phone: string, code: string): Promise<void> {
    await applySession(await sessionRequest('/otp/verify', clientSessionSchema, { phone, code }));
  },

  resetPassword(phone: string, code: string, newPassword: string): Promise<void> {
    return sessionRequest('/password/reset', z.void(), { phone, code, newPassword });
  },

  async logout(): Promise<void> {
    try {
      await sessionRequest('/logout', z.void());
    } finally {
      clearSession('logout');
    }
  },
};

/** Le SUPER_ADMIN a toutes les permissions ; sinon, lecture des droits effectifs. */
export function hasPermission(session: SessionState, permission: PermissionKey): boolean {
  return session.context?.role === 'SUPER_ADMIN' || session.permissions.has(permission);
}
