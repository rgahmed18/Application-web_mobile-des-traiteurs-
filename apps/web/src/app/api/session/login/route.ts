import { loginSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
  requestSpace,
  spaceNotFound,
} from '../_lib/bff';

const bodySchema = loginSchema.omit({ traiteurSlug: true, space: true });

/**
 * Connexion par téléphone ou email + mot de passe. Le traiteur vient de l'adresse (jamais du
 * navigateur) ; sur l'adresse de la console, seul le super admin peut se connecter.
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, bodySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const space = await requestSpace(request);
    if (!space) return spaceNotFound();
    const apiResponse = await callApi(request, '/auth/login', {
      ...body,
      ...(space.kind === 'traiteur' ? { traiteurSlug: space.traiteur.slug } : {}),
      // Espace de gestion : jamais d'inscription automatique comme client
      space: 'backoffice',
    });
    return await finishSession(request, apiResponse, space);
  } catch {
    return apiUnreachable();
  }
}
