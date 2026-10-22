import { twoFactorChallengeSetupSchema } from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  apiUnreachable,
  callApi,
  jsonError,
  readBody,
  rejectCrossOrigin,
  relayError,
} from '../../_lib/bff';

/** Activation imposée à la connexion : clé et QR code à scanner (aucune session encore). */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, twoFactorChallengeSetupSchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(request, '/auth/2fa/setup', body);
    if (!apiResponse.ok) return await relayError(apiResponse);
    return NextResponse.json(await apiResponse.json(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return apiUnreachable();
  }
}
