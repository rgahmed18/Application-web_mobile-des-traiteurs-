import type { z } from 'zod';

import { publicEnv } from '@/lib/env/public';

import { ApiError, NetworkError, toApiError } from './errors';

/**
 * Client HTTP du back-office vers l'API.
 * - ajoute l'access token (gardé en mémoire par le store de session) ;
 * - sur un 401, rafraîchit la session une fois et rejoue la requête ;
 * - valide chaque réponse avec un schéma Zod partagé : aucune donnée non vérifiée n'entre.
 */
export interface AuthHooks {
  /** Access token valide (rafraîchi si proche de l'expiration), ou null sans session. */
  getAccessToken: () => Promise<string | null>;
  /** Force un rafraîchissement ; retourne le nouveau token, ou null si la session est perdue. */
  refreshAccessToken: () => Promise<string | null>;
}

let authHooks: AuthHooks | null = null;

/** Branché par le store de session au démarrage. */
export function configureApiAuth(hooks: AuthHooks): void {
  authHooks = hooks;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions<TSchema extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Schéma de la réponse (z.void() pour un 204). */
  schema: TSchema;
  signal?: AbortSignal;
  /** Jeton imposé (utilisé par le store de session) ; sinon celui de la session. */
  accessToken?: string;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function send(url: string, init: RequestInit, accessToken: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(url, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  }
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  { method = 'GET', body, query, schema, signal, accessToken }: ApiRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const url = buildUrl(path, query);
  const init: RequestInit = {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let token = accessToken ?? (await authHooks?.getAccessToken()) ?? null;
  let response = await send(url, init, token);

  // Jeton expiré ou révoqué entre-temps : un seul rafraîchissement, puis nouvel essai
  if (response.status === 401 && !accessToken && authHooks) {
    token = await authHooks.refreshAccessToken();
    if (token) response = await send(url, init, token);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return schema.parse(undefined);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Réponse illisible');
  }
  return schema.parse(payload);
}

/** Appel aux routes de session de Next (même origine, cookie httpOnly). */
export async function sessionRequest<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  body: unknown = {},
): Promise<z.infer<TSchema>> {
  let response: Response;
  try {
    response = await fetch(`/api/session${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return schema.parse(response.status === 204 ? undefined : await response.json());
}
