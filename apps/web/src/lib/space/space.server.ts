import 'server-only';

import { type DemoSpaces, demoSpacesSchema, type Space, spaceSchema } from '@traiteur/shared';
import { cookies, headers } from 'next/headers';

import { serverEnv } from '@/lib/env/server';

/**
 * Espace servi par la requête : console de la plateforme, ou back-office d'un traiteur. Le
 * traiteur vient TOUJOURS de l'adresse (en-tête Host), résolue par l'API ; jamais d'un paramètre
 * envoyé par le navigateur. Seule exception, la démonstration (DEMO_SPACE_SELECTION, refusée en
 * production) : sur l'adresse de la console, un cookie désigne le traiteur choisi.
 */

/** Cookie de la démonstration : identifiant du traiteur choisi. */
export const DEMO_SPACE_COOKIE = 'gt_demo_space';

export class SpaceUnavailableError extends Error {}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { space: Space | null; expiresAt: number }>();

async function fetchSpace(path: string): Promise<Space | null> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.space;
  let response: Response;
  try {
    response = await fetch(`${serverEnv().API_INTERNAL_URL}${path}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new SpaceUnavailableError("Le serveur de l'application est injoignable");
  }
  let space: Space | null = null;
  if (response.ok) {
    const parsed = spaceSchema.safeParse(await response.json());
    if (!parsed.success) throw new SpaceUnavailableError("Réponse inattendue de l'API");
    space = parsed.data;
  } else if (response.status !== 404) {
    throw new SpaceUnavailableError(`API : statut ${response.status}`);
  }
  if (cache.size > 500) cache.clear();
  cache.set(path, { space, expiresAt: Date.now() + CACHE_TTL_MS });
  return space;
}

/**
 * Espace d'une adresse et, en démonstration seulement, du traiteur choisi (cookie). Null :
 * « Espace introuvable ».
 */
export async function resolveSpace(
  host: string | null,
  demoSlug: string | undefined,
): Promise<Space | null> {
  if (!host) return null;
  const space = await fetchSpace(`/public/spaces/resolve?host=${encodeURIComponent(host)}`);
  if (
    space?.kind === 'platform' &&
    serverEnv().DEMO_SPACE_SELECTION &&
    demoSlug &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(demoSlug)
  ) {
    return fetchSpace(`/public/spaces/demo/${demoSlug}`);
  }
  return space;
}

/** Espace de la requête en cours (composants serveur). */
export async function currentSpace(): Promise<Space | null> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  return resolveSpace(headerList.get('host'), cookieStore.get(DEMO_SPACE_COOKIE)?.value);
}

/** Démonstration : traiteurs proposés au choix (null hors démonstration). */
export async function demoSpaces(): Promise<DemoSpaces | null> {
  if (!serverEnv().DEMO_SPACE_SELECTION) return null;
  try {
    const response = await fetch(`${serverEnv().API_INTERNAL_URL}/public/spaces/demo`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const parsed = demoSpacesSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
