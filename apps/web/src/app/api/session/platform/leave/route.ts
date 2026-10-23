import type { NextRequest } from 'next/server';

import {
  apiUnreachable,
  bearerHeader,
  callApi,
  finishSession,
  jsonError,
  rejectCrossOrigin,
  relayError,
} from '../../_lib/bff';

/**
 * Le super admin quitte le traiteur : l'API clôt l'accès, révoque les sessions ouvertes chez lui
 * et renvoie une session de la console (cookie renouvelé).
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const authorization = bearerHeader(request);
  if (!authorization) return jsonError(401, 'INVALID_TOKEN', 'Aucune session');

  try {
    const apiResponse = await callApi(request, '/platform/access/leave', {}, authorization);
    // Accès déjà expiré : le cookie est gardé, le rafraîchissement ramènera à la console
    if (!apiResponse.ok) return await relayError(apiResponse);
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
