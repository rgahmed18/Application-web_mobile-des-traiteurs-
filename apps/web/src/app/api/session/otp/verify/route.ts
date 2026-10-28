import { otpCodeSchema, phoneSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  apiUnreachable,
  callApi,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
  requestSpace,
  spaceNotFound,
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
    const space = await requestSpace(request);
    if (!space) return spaceNotFound();
    if (space.kind === 'platform') {
      // Console : connexion par mot de passe et double authentification uniquement
      return jsonError(
        403,
        'NO_BACKOFFICE_ACCESS',
        "La connexion par code SMS n'est pas disponible sur la console de la plateforme",
      );
    }
    const apiResponse = await callApi(request, '/auth/otp/verify', {
      ...body,
      traiteurSlug: space.traiteur.slug,
      // Espace de gestion : ni création de compte ni inscription automatique comme client
      space: 'backoffice',
    });
    return await finishSession(request, apiResponse, space);
  } catch {
    return apiUnreachable();
  }
}
