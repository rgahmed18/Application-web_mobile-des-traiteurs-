import { type NextRequest, NextResponse } from 'next/server';

import {
  callApi,
  clearRefreshCookie,
  CLIENT_SESSION,
  rejectCrossOrigin,
} from '../../session/_lib/bff';

/** Site client : révoque la session côté API et efface ses cookies, même si l'API est injoignable. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const refreshToken = request.cookies.get(CLIENT_SESSION.refreshCookie)?.value;
  if (refreshToken) {
    await callApi(request, '/auth/logout', { refreshToken }).catch(() => undefined);
  }
  const response = new NextResponse(null, { status: 204 });
  clearRefreshCookie(response, CLIENT_SESSION);
  return response;
}
