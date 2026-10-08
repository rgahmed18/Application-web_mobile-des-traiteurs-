import { phoneSchema } from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  apiUnreachable,
  callApi,
  jsonError,
  readBody,
  rejectCrossOrigin,
  relayError,
} from '../../_lib/bff';

const bodySchema = z.object({
  phone: phoneSchema,
  /** LOGIN : connexion ; PASSWORD_RESET : mot de passe oublié. */
  purpose: z.enum(['LOGIN', 'PASSWORD_RESET']),
});

/** Demande d'un code SMS (connexion ou mot de passe oublié). */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, bodySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(request, '/auth/otp/request', body);
    if (!apiResponse.ok) return await relayError(apiResponse);
    return NextResponse.json(await apiResponse.json());
  } catch {
    return apiUnreachable();
  }
}
