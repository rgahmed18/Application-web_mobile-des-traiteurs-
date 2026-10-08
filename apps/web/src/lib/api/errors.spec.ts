import { describe, expect, it } from 'vitest';

import fr from '../../../messages/fr.json';
import {
  ApiError,
  errorMessageKey,
  NetworkError,
  toApiError,
  TRANSLATED_ERROR_CODES,
} from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('toApiError', () => {
  it('lit le code, le message et les erreurs de validation', async () => {
    const error = await toApiError(
      json(400, {
        code: 'VALIDATION_ERROR',
        message: 'Données invalides',
        issues: [{ path: 'name.fr', message: 'Trop court' }],
      }),
    );
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(error.issues).toEqual([{ path: 'name.fr', message: 'Trop court' }]);
  });

  it('donne un code au limiteur de débit, qui répond sans code applicatif', async () => {
    const error = await toApiError(json(429, { statusCode: 429, message: 'Too Many Requests' }));
    expect(error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('supporte une réponse sans corps JSON', async () => {
    const error = await toApiError(new Response('Bad gateway', { status: 502 }));
    expect(error.code).toBe('HTTP_502');
  });

  it('conserve le délai avant nouvel essai', async () => {
    const error = await toApiError(json(429, { code: 'OTP_RATE_LIMITED', retryAfterSeconds: 42 }));
    expect(error.retryAfterSeconds).toBe(42);
  });
});

describe('errorMessageKey', () => {
  it('traduit un code connu', () => {
    expect(errorMessageKey(new ApiError(401, 'INVALID_CREDENTIALS', ''))).toBe(
      'api.INVALID_CREDENTIALS',
    );
  });

  it('se replie sur un message générique pour un code inconnu', () => {
    expect(errorMessageKey(new ApiError(500, 'HTTP_500', ''))).toBe('generic');
    expect(errorMessageKey(new Error('boom'))).toBe('generic');
  });

  it('distingue les erreurs réseau', () => {
    expect(errorMessageKey(new NetworkError(new TypeError('fetch failed')))).toBe('network');
  });

  it('chaque code traduit a bien un message dans fr.json', () => {
    for (const code of TRANSLATED_ERROR_CODES) {
      expect(fr.errors.api[code], code).toBeTruthy();
    }
  });
});
