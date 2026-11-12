import { clientVerifySchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  callApi,
  CLIENT_SESSION,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
  requestSpace,
  spaceNotFound,
} from '../../session/_lib/bff';

/**
 * Site client : code vérifié, session du client chez CE traiteur (cookie propre au site client).
 * Inscription ou consentement demandés : réponse relayée telle quelle, aucun cookie posé.
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, clientVerifySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const space = await requestSpace(request);
    if (space?.kind !== 'traiteur') return spaceNotFound();
    const apiResponse = await callApi(request, '/auth/client/verify', {
      ...body,
      traiteurSlug: space.traiteur.slug,
    });
    return await finishSession(request, apiResponse, space, CLIENT_SESSION);
  } catch {
    return apiUnreachable();
  }
}
