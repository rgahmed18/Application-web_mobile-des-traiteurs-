import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  clearRefreshCookie,
  CLIENT_SESSION,
  finishSession,
  jsonError,
  rejectCrossOrigin,
} from '../../session/_lib/bff';

/** Site client : rotation du refresh token (cookie du site client), nouvel access token. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const refreshToken = request.cookies.get(CLIENT_SESSION.refreshCookie)?.value;
  if (!refreshToken) {
    const response = jsonError(401, 'INVALID_TOKEN', 'Aucune session');
    clearRefreshCookie(response, CLIENT_SESSION);
    return response;
  }

  try {
    const apiResponse = await callApi(request, '/auth/refresh', { refreshToken });
    return await finishSession(request, apiResponse, undefined, CLIENT_SESSION);
  } catch {
    return apiUnreachable();
  }
}
