import { platformAccessReasonSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  apiUnreachable,
  bearerHeader,
  callApi,
  finishSession,
  jsonError,
  readBody,
  REFRESH_COOKIE,
  rejectCrossOrigin,
} from '../../_lib/bff';

const enterSchema = platformAccessReasonSchema.extend({ traiteurId: z.uuid() });

/**
 * Le super admin entre chez un traiteur depuis la console (motif obligatoire) : la session de la
 * console est remplacée par une session limitée à ce traiteur (cookie renouvelé).
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const authorization = bearerHeader(request);
  if (!authorization) return jsonError(401, 'INVALID_TOKEN', 'Aucune session');
  const body = await readBody(request, enterSchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(
      request,
      `/platform/traiteurs/${body.traiteurId}/enter`,
      { reason: body.reason },
      authorization,
    );
    if (apiResponse.ok) {
      // La session de la console est close : la sortie en ouvrira une nouvelle
      const previous = request.cookies.get(REFRESH_COOKIE)?.value;
      if (previous) {
        await callApi(request, '/auth/logout', { refreshToken: previous }).catch(() => undefined);
      }
    }
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
