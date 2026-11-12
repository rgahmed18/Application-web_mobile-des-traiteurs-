import { clientCodeRequestSchema } from '@traiteur/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  apiUnreachable,
  callApi,
  jsonError,
  readBody,
  rejectCrossOrigin,
  relayError,
  requestSpace,
  spaceNotFound,
} from '../../session/_lib/bff';

/**
 * Site client : code de connexion par SMS, ou par e-mail pour un numéro étranger. Le traiteur
 * vient de l'adresse, jamais du navigateur.
 */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, clientCodeRequestSchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const space = await requestSpace(request);
    if (space?.kind !== 'traiteur') return spaceNotFound();
    const apiResponse = await callApi(request, '/auth/client/code', {
      ...body,
      traiteurSlug: space.traiteur.slug,
    });
    if (!apiResponse.ok) return await relayError(apiResponse);
    return NextResponse.json(await apiResponse.json());
  } catch {
    return apiUnreachable();
  }
}
