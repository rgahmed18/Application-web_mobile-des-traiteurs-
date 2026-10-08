import 'server-only';

import { type AuthSession, authSessionSchema } from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

import { serverEnv } from '@/lib/env/server';

/**
 * Proxy de session (« Backend For Frontend »).
 * Seul endroit qui voit le refresh token : il vit dans un cookie httpOnly, Secure,
 * SameSite=Strict, limité au chemin /api/session. Le navigateur ne reçoit que l'access token,
 * conservé en mémoire.
 */
export const REFRESH_COOKIE = 'gt_refresh';
const COOKIE_PATH = '/api/session';

type JsonBody = Record<string, unknown>;

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status });
}

/**
 * Protection CSRF : en plus de SameSite=Strict, les requêtes doivent venir de ce site.
 * Les navigateurs envoient toujours l'en-tête Origin sur un fetch POST.
 */
export function rejectCrossOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    return jsonError(403, 'CROSS_ORIGIN', 'Origine de la requête refusée');
  }
  return null;
}

/** Corps JSON validé par un schéma Zod partagé ; null si invalide. */
export async function readBody<TSchema extends z.ZodType>(
  request: NextRequest,
  schema: TSchema,
): Promise<z.infer<TSchema> | null> {
  try {
    const result = schema.safeParse(await request.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** IP du navigateur, transmise à l'API pour la limitation de débit et le journal d'audit. */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip');
}

/** Appel POST à l'API depuis le serveur Next. */
export async function callApi(
  request: NextRequest,
  path: string,
  body: JsonBody,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const ip = clientIp(request);
  if (ip) headers['X-Forwarded-For'] = ip;
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers['User-Agent'] = userAgent;

  return fetch(`${serverEnv().API_INTERNAL_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** Relaie tel quel une réponse d'erreur de l'API (code et message stables). */
export async function relayError(response: Response): Promise<NextResponse> {
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body ?? { code: `HTTP_${response.status}` }, {
    status: response.status,
  });
}

export function apiUnreachable(): NextResponse {
  return jsonError(502, 'API_UNREACHABLE', "Le serveur de l'application est injoignable");
}

export function setRefreshCookie(response: NextResponse, refreshToken: string): void {
  const env = serverEnv();
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: env.REFRESH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
  });
}

export function clearRefreshCookie(response: NextResponse): void {
  response.cookies.set(REFRESH_COOKIE, '', { path: COOKIE_PATH, maxAge: 0 });
}

/** Ce que reçoit le navigateur : la session sans le refresh token. */
export type ClientSession = Omit<AuthSession, 'refreshToken'>;

/**
 * Termine une connexion (mot de passe, code SMS ou rafraîchissement) : vérifie la réponse de
 * l'API, refuse les comptes sans accès au back-office (clients), pose le cookie.
 */
export async function finishSession(
  request: NextRequest,
  apiResponse: Response,
): Promise<NextResponse> {
  if (!apiResponse.ok) {
    const response = await relayError(apiResponse);
    if (apiResponse.status === 401) clearRefreshCookie(response);
    return response;
  }

  const parsed = authSessionSchema.safeParse(await apiResponse.json());
  if (!parsed.success) return jsonError(502, 'API_UNREACHABLE', "Réponse inattendue de l'API");
  const { refreshToken, ...session } = parsed.data;

  if (session.context.role === 'CLIENT') {
    // Un client n'a rien à faire dans le back-office : la session est aussitôt révoquée.
    await callApi(request, '/auth/logout', { refreshToken }).catch(() => undefined);
    const response = jsonError(
      403,
      'NO_BACKOFFICE_ACCESS',
      "Ce compte n'a pas accès à l'espace de gestion",
    );
    clearRefreshCookie(response);
    return response;
  }

  const response = NextResponse.json(session satisfies ClientSession);
  setRefreshCookie(response, refreshToken);
  return response;
}
