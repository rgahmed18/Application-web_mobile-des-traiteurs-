import { twoFactorChallengeConfirmSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  finishTwoFactorSetup,
  jsonError,
  readBody,
  rejectCrossOrigin,
} from '../../_lib/bff';

/** Premier code de l'application : session ouverte et codes de secours (affichés une fois). */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, twoFactorChallengeConfirmSchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    return await finishTwoFactorSetup(
      request,
      await callApi(request, '/auth/2fa/setup/confirm', body),
    );
  } catch {
    return apiUnreachable();
  }
}
