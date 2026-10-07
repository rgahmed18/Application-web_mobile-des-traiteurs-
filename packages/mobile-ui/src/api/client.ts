import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiClientOptions {
  baseUrl: string;
  /** Fournit le jeton d'accès courant (stockage sécurisé côté app). */
  getAccessToken?: () => string | null | Promise<string | null>;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  method?: HttpMethod;
  body?: unknown;
  /** Schéma Zod qui valide la réponse : aucune donnée non vérifiée n'entre dans l'app. */
  schema: TSchema;
  signal?: AbortSignal;
}

/** Erreur HTTP renvoyée par l'API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Erreur API (${status})`);
    this.name = 'ApiError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

/** Crée un client HTTP typé pour l'API de la plateforme. */
export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<TSchema extends z.ZodType>(
    path: string,
    { method = 'GET', body, schema, signal }: RequestOptions<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const token = getAccessToken ? await getAccessToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    const payload = await readJson(response);
    if (!response.ok) throw new ApiError(response.status, payload);
    return schema.parse(payload);
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
