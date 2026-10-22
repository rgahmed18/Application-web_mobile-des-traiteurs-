import { twoFactorVerifySchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
} from '../../_lib/bff';

/** Deuxième étape de la connexion : code de l'application ou code de secours. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, twoFactorVerifySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    return await finishSession(request, await callApi(request, '/auth/2fa/verify', body));
  } catch {
    return apiUnreachable();
  }
}
