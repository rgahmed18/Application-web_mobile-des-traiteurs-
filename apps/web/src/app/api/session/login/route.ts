import { loginSchema } from '@traiteur/shared';
import type { NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env/server';

import {
  apiUnreachable,
  callApi,
  finishSession,
  jsonError,
  readBody,
  rejectCrossOrigin,
} from '../_lib/bff';

const bodySchema = loginSchema.omit({ traiteurSlug: true });

/** Connexion par téléphone ou email + mot de passe. */
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const body = await readBody(request, bodySchema);
  if (!body) return jsonError(400, 'VALIDATION_ERROR', 'Données invalides');

  try {
    const apiResponse = await callApi(request, '/auth/login', {
      ...body,
      traiteurSlug: serverEnv().TRAITEUR_SLUG,
    });
    return await finishSession(request, apiResponse);
  } catch {
    return apiUnreachable();
  }
}
