import type { z } from 'zod';
import { EDIT_VERSION_HEADER } from '@traiteur/shared';

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
  /** Refus de l'API (403) : un compte, un accès ou un traiteur suspendu termine la session. */
  onAccessDenied?: (code: string) => Promise<void>;
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
  /**
   * Version de l'élément chargé (verrouillage optimiste, en-tête If-Match) : l'API refuse (409
   * EDIT_CONFLICT) s'il a été modifié entre-temps.
   */
  ifMatch?: string | null;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  // PUBLIC_API_URL peut être un chemin (« /api/v1 ») : relatif à l'adresse de la page
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(`${publicEnv().PUBLIC_API_URL}${path}`, base);
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
  { method = 'GET', body, query, schema, signal, accessToken, ifMatch }: ApiRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const url = buildUrl(path, query);
  // Fichier envoyé tel quel (multipart) ; sinon corps JSON
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (ifMatch) headers[EDIT_VERSION_HEADER] = `"${ifMatch}"`;
  const init: RequestInit = {
    method,
    signal,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  };

  let token = accessToken ?? (await authHooks?.getAccessToken()) ?? null;
  let response = await send(url, init, token);

  // Jeton expiré ou révoqué entre-temps : un seul rafraîchissement, puis nouvel essai
  if (response.status === 401 && !accessToken && authHooks) {
    token = await authHooks.refreshAccessToken();
    if (token) response = await send(url, init, token);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 403 && !accessToken && authHooks?.onAccessDenied) {
      void authHooks.onAccessDenied(error.code);
    }
    throw error;
  }
  if (response.status === 204) return schema.parse(undefined);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Réponse illisible');
  }
  return schema.parse(payload);
}

/**
 * Appel aux routes de session de Next (même origine, cookie httpOnly). `base` : routes du
 * back-office (/api/session) ou du site client (/api/client-session).
 */
export async function sessionRequest<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  body: unknown = {},
  accessToken?: string | null,
  base = '/api/session',
): Promise<z.infer<TSchema>> {
  let response: Response;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return schema.parse(response.status === 204 ? undefined : await response.json());
}

/** Envoi d'un fichier (multipart, champ « file ») vers l'API, avec la même gestion de session. */
export function uploadFile<TSchema extends z.ZodType>(
  path: string,
  file: File,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest(path, { method: 'POST', body: form, schema });
}

/**
 * Téléchargement d'un fichier produit par l'API (export xlsx, CSV) : même gestion de session,
 * puis enregistrement sous le nom proposé par l'API (Content-Disposition).
 */
export async function downloadFile(
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<void> {
  const url = buildUrl(path, query);
  let token = (await authHooks?.getAccessToken()) ?? null;
  let response = await send(url, { method: 'GET' }, token);
  if (response.status === 401 && authHooks) {
    token = await authHooks.refreshAccessToken();
    if (token) response = await send(url, { method: 'GET' }, token);
  }
  if (!response.ok) throw await toApiError(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export';
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
