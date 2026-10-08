import { type NextRequest, NextResponse } from 'next/server';

import { callApi, clearRefreshCookie, REFRESH_COOKIE, rejectCrossOrigin } from '../_lib/bff';

/** Déconnexion : révoque la session côté API et efface le cookie, même si l'API est injoignable. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await callApi(request, '/auth/logout', { refreshToken }).catch(() => undefined);
  }
  const response = new NextResponse(null, { status: 204 });
  clearRefreshCookie(response);
  return response;
}
