import { passwordResetSchema } from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  apiUnreachable,
  callApi,
  jsonError,
  readBody,
  rejectCrossOrigin,
  relayError,
} from '../../_lib/bff';

/** Nouveau mot de passe après réception d'un code PASSWORD_RESET. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, passwordResetSchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(request, '/auth/password/reset', body);
    if (!apiResponse.ok) return await relayError(apiResponse);
    return new NextResponse(null, { status: 204 });
  } catch {
    return apiUnreachable();
  }
}
