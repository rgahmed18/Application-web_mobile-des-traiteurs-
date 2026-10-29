'use client';

import {
  type Draft,
  type DraftFormKey,
  type DraftList,
  draftListSchema,
  type DraftSaveInput,
  draftSchema,
  type DraftSummary,
  draftSummarySchema,
  stripSensitiveFields,
} from '@traiteur/shared';
import { z } from 'zod';

import { currentAccessToken } from '@/features/auth/session-store';
import { apiRequest } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { publicEnv } from '@/lib/env/public';

/**
 * Brouillons côté serveur (jamais dans le navigateur). Les champs sensibles sont retirés ici
 * avant l'envoi, et de nouveau par l'API.
 */
const path = (formKey: DraftFormKey) => `/me/drafts/${encodeURIComponent(formKey)}`;

function payload(input: DraftSaveInput): DraftSaveInput {
  return { ...input, data: stripSensitiveFields(input.data) as Record<string, unknown> };
}

export function listDrafts(): Promise<DraftList> {
  return apiRequest('/me/drafts', { schema: draftListSchema });
}

/** Brouillon d'un formulaire ; null s'il n'y en a pas. */
export async function getDraft(formKey: DraftFormKey): Promise<Draft | null> {
  try {
    return await apiRequest(path(formKey), { schema: draftSchema });
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

export function saveDraft(formKey: DraftFormKey, input: DraftSaveInput): Promise<DraftSummary> {
  return apiRequest(path(formKey), {
    method: 'PUT',
    body: payload(input),
    schema: draftSummarySchema,
  });
}

export function deleteDraft(formKey: DraftFormKey): Promise<void> {
  return apiRequest(path(formKey), { method: 'DELETE', schema: z.void() });
}

/** Limite des navigateurs pour un envoi « keepalive » (corps de 64 Ko au plus). */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Fermeture ou rechargement de la page : envoi qui survit à la page (fetch « keepalive »). Sans
 * jeton valide, ou au-delà de la limite des navigateurs, rien n'est envoyé : l'enregistrement
 * automatique précédent (quelques secondes plus tôt) fait foi.
 */
export function saveDraftOnUnload(formKey: DraftFormKey, input: DraftSaveInput): boolean {
  const token = currentAccessToken();
  if (!token) return false;
  const body = JSON.stringify(payload(input));
  if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return false;
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  void fetch(new URL(`${publicEnv().PUBLIC_API_URL}${path(formKey)}`, base), {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  }).catch(() => undefined);
  return true;
}
