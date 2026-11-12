import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  type AuthSession,
  authSessionSchema,
  type Space,
  twoFactorChallengeConfirmResultSchema,
  twoFactorChallengeSchema,
} from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

import { SESSION_MARK_COOKIE } from '@/features/auth/session-wake';
import { serverEnv } from '@/lib/env/server';
import { DEMO_SPACE_COOKIE, resolveSpace } from '@/lib/space/space.server';

import { clientIpFromHeaders } from './client-ip';

/**
 * Proxy de session (« Backend For Frontend »).
 * Seul endroit qui voit le refresh token : il vit dans un cookie httpOnly, Secure,
 * SameSite=Strict, limité au chemin des routes de session. Le navigateur ne reçoit que l'access
 * token, conservé en mémoire.
 *
 * Deux sessions indépendantes sur une même adresse de traiteur, chacune avec ses cookies :
 * l'espace de gestion (personnel, /api/session) et le site client (clients, /api/client-session).
 * Un membre du personnel et un client peuvent ainsi utiliser le même navigateur sans s'écraser.
 */
export const REFRESH_COOKIE = 'gt_refresh';
const COOKIE_PATH = '/api/session';

/** Espace d'une session : ses cookies et les sessions qu'il accepte. */
export interface SessionKind {
  refreshCookie: string;
  cookiePath: string;
  markCookie: string;
  /** Routes qui continuent la même session (repère conservé). */
  samePaths: RegExp;
  accepts: (context: AuthSession['context'], space: Space) => boolean;
  denied: () => NextResponse;
}

/** Espace de gestion (et console) : sessions du personnel ou du super admin. */
export const BACKOFFICE_SESSION: SessionKind = {
  refreshCookie: REFRESH_COOKIE,
  cookiePath: COOKIE_PATH,
  markCookie: SESSION_MARK_COOKIE,
  samePaths: /\/api\/session\/(refresh|platform\/(enter|leave))$/,
  accepts: (context, space) => context.role !== 'CLIENT' && sessionMatchesSpace(context, space),
  denied: () =>
    jsonError(403, 'NO_BACKOFFICE_ACCESS', "Ce compte n'a pas accès à l'espace de gestion"),
};

/** Repère de la session du site client (lisible, sans secret, voir session-wake.ts). */
export const CLIENT_SESSION_MARK_COOKIE = 'gt_client_mark';

/** Site client : sessions des clients de CE traiteur seulement. */
export const CLIENT_SESSION: SessionKind = {
  refreshCookie: 'gt_client_refresh',
  cookiePath: '/api/client-session',
  markCookie: CLIENT_SESSION_MARK_COOKIE,
  samePaths: /\/api\/client-session\/refresh$/,
  accepts: (context, space) =>
    context.role === 'CLIENT' &&
    space.kind === 'traiteur' &&
    context.traiteurId === space.traiteur.id,
  denied: () => jsonError(403, 'USE_BACKOFFICE', "Ce compte n'est pas un compte client"),
};

type JsonBody = Record<string, unknown>;

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status });
}

/**
 * Protection CSRF : en plus de SameSite=Strict, les requêtes doivent venir de ce site.
 * Les navigateurs envoient toujours l'en-tête Origin sur un fetch POST.
 * Seul l'en-tête Host est comparé : X-Forwarded-Host peut être envoyé par le client (Next ne le
 * renseigne que s'il est absent). Derrière un proxy, celui-ci doit transmettre le Host d'origine.
 */
export function rejectCrossOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
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

/**
 * Appel POST à l'API depuis le serveur Next. `authorization` : jeton du navigateur, relayé pour
 * les routes qui exigent une session (entrer chez un traiteur, en sortir).
 */
export async function callApi(
  request: NextRequest,
  path: string,
  body: JsonBody,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  // IP du navigateur (limitation de débit, journal d'audit) : seulement si elle vient de nos
  // proxys ; sinon aucune, et l'API voit l'adresse du serveur Next. Les en-têtes du client ne
  // sont jamais recopiés.
  const ip = clientIpFromHeaders(request.headers, serverEnv().WEB_TRUSTED_PROXY_HOPS);
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

/** En-tête « Authorization: Bearer … » du navigateur, ou null. */
export function bearerHeader(request: NextRequest): string | null {
  const value = request.headers.get('authorization');
  return value && /^Bearer [\w.-]+$/.test(value) ? value : null;
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

/**
 * Cookie de session (httpOnly) et repère de session lisible par les onglets (identifiant
 * aléatoire, sans secret, voir features/auth/session-wake.ts) : conservé pour la même session,
 * nouveau à chaque connexion.
 */
export function setRefreshCookie(
  request: NextRequest,
  response: NextResponse,
  refreshToken: string,
  kind: SessionKind = BACKOFFICE_SESSION,
): void {
  const env = serverEnv();
  const maxAge = env.REFRESH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  response.cookies.set(kind.refreshCookie, refreshToken, {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: 'strict',
    path: kind.cookiePath,
    maxAge,
  });
  const current = request.cookies.get(kind.markCookie)?.value;
  const keep = current && kind.samePaths.test(request.nextUrl.pathname);
  response.cookies.set(kind.markCookie, keep ? current : randomUUID(), {
    httpOnly: false,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

export function clearRefreshCookie(
  response: NextResponse,
  kind: SessionKind = BACKOFFICE_SESSION,
): void {
  response.cookies.set(kind.refreshCookie, '', { path: kind.cookiePath, maxAge: 0 });
  response.cookies.set(kind.markCookie, '', { path: '/', maxAge: 0 });
}

/** Ce que reçoit le navigateur : la session sans le refresh token. */
export type ClientSession = Omit<AuthSession, 'refreshToken'>;

/**
 * Termine une connexion (mot de passe, code SMS, deuxième étape ou rafraîchissement) : vérifie
 * la réponse de l'API, refuse les comptes sans accès au back-office (clients), pose le cookie.
 * Une deuxième étape demandée (double authentification) est relayée telle quelle : aucun
 * cookie n'est posé avant le code.
 */
export async function finishSession(
  request: NextRequest,
  apiResponse: Response,
  space?: Space,
  kind: SessionKind = BACKOFFICE_SESSION,
): Promise<NextResponse> {
  if (!apiResponse.ok) {
    const response = await relayError(apiResponse);
    if (apiResponse.status === 401) clearRefreshCookie(response, kind);
    return response;
  }

  const body: unknown = await apiResponse.json();
  const challenge = twoFactorChallengeSchema.safeParse(body);
  if (challenge.success) return NextResponse.json(challenge.data);
  const parsed = authSessionSchema.safeParse(body);
  if (!parsed.success) return jsonError(502, 'API_UNREACHABLE', "Réponse inattendue de l'API");
  return sessionResponse(request, parsed.data, space, undefined, kind);
}

/** Espace servi par l'adresse de la requête ; null : « Espace introuvable ». */
export function requestSpace(request: NextRequest): Promise<Space | null> {
  return resolveSpace(request.headers.get('host'), request.cookies.get(DEMO_SPACE_COOKIE)?.value);
}

export function spaceNotFound(): NextResponse {
  return jsonError(404, 'SPACE_NOT_FOUND', 'Espace introuvable');
}

/**
 * Une session ne vaut que pour l'espace de son adresse : sur celle d'un traiteur, une session de
 * son personnel ; sur celle de la console, une session du super admin (console, ou entré chez
 * un traiteur depuis la console).
 */
export function sessionMatchesSpace(context: AuthSession['context'], space: Space): boolean {
  if (space.kind === 'platform') return context.role === 'SUPER_ADMIN';
  return (
    context.role !== 'SUPER_ADMIN' &&
    context.role !== 'CLIENT' &&
    context.traiteurId === space.traiteur.id
  );
}

/**
 * Activation imposée réussie à la connexion : session (cookie posé) et codes de secours, que le
 * navigateur affiche une seule fois.
 */
export async function finishTwoFactorSetup(
  request: NextRequest,
  apiResponse: Response,
): Promise<NextResponse> {
  if (!apiResponse.ok) return relayError(apiResponse);
  const parsed = twoFactorChallengeConfirmResultSchema.safeParse(await apiResponse.json());
  if (!parsed.success) return jsonError(502, 'API_UNREACHABLE', "Réponse inattendue de l'API");
  return sessionResponse(request, parsed.data.session, undefined, {
    recoveryCodes: parsed.data.recoveryCodes,
  });
}

async function sessionResponse(
  request: NextRequest,
  { refreshToken, ...session }: AuthSession,
  knownSpace?: Space,
  extra?: { recoveryCodes: string[] },
  kind: SessionKind = BACKOFFICE_SESSION,
): Promise<NextResponse> {
  const space = knownSpace ?? (await requestSpace(request));
  if (!space || !kind.accepts(session.context, space)) {
    // Un client n'a rien à faire dans le back-office (ni le personnel sur le site client), et une
    // session ne sert que sur l'adresse de son espace : elle est aussitôt révoquée.
    await callApi(request, '/auth/logout', { refreshToken }).catch(() => undefined);
    const response = kind.denied();
    clearRefreshCookie(response, kind);
    return response;
  }

  const response = NextResponse.json(
    extra
      ? { session: session satisfies ClientSession, ...extra }
      : (session satisfies ClientSession),
  );
  setRefreshCookie(request, response, refreshToken, kind);
  return response;
}
