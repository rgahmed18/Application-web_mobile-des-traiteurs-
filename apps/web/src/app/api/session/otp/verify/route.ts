import { otpCodeSchema, phoneSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env/server';

import {
  apiUnreachable,
  callApi,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
} from '../../_lib/bff';

const bodySchema = z.object({ phone: phoneSchema, code: otpCodeSchema });

/**
 * Connexion par code SMS. Aucun prénom ni nom n'est transmis : un numéro inconnu reçoit
 * PROFILE_REQUIRED, le back-office ne crée jamais de compte.
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, bodySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(request, '/auth/otp/verify', {
      ...body,
      traiteurSlug: serverEnv().TRAITEUR_SLUG,
    });
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
