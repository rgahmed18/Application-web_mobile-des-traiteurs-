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
 * Connexion par code SMS à l'espace de gestion : un numéro inconnu, un client ou un membre d'un
 * autre traiteur reçoivent la même réponse (NO_BACKOFFICE_ACCESS) ; aucun compte n'est créé.
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
      // Espace de gestion : ni création de compte ni inscription automatique comme client
      space: 'backoffice',
    });
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
