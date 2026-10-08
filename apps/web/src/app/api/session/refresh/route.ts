import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  clearRefreshCookie,
  finishSession,
  jsonError,
  REFRESH_COOKIE,
  rejectCrossOrigin,
} from '../_lib/bff';

/**
 * Rotation du refresh token (cookie) : renvoie un nouvel access token.
 * Appelée au chargement de la page (restauration de session) et avant chaque expiration.
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = jsonError(401, 'INVALID_TOKEN', 'Aucune session');
    clearRefreshCookie(response);
    return response;
  }

  try {
    const apiResponse = await callApi(request, '/auth/refresh', { refreshToken });
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
