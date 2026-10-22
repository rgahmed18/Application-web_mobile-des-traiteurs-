import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi, finishSession, REFRESH_COOKIE } from './bff';

/** En-têtes réellement envoyés à l'API par le serveur Next. */
async function forwardedHeaders(incoming: Record<string, string>): Promise<Headers> {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  const request = new Request('http://localhost:3001/api/session/login', {
    method: 'POST',
    headers: incoming,
  }) as unknown as NextRequest;
  await callApi(request, '/auth/login', {});
  return new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
}

describe('callApi (WEB_TRUSTED_PROXY_HOPS par défaut : 0)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ne recopie jamais X-Forwarded-For ni X-Real-IP envoyés par le navigateur', async () => {
    const headers = await forwardedHeaders({
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '7.7.7.7',
      'user-agent': 'Navigateur de test',
    });
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(headers.get('x-real-ip')).toBeNull();
    expect(headers.get('user-agent')).toBe('Navigateur de test');
  });
});

describe('finishSession : double authentification', () => {
  const request = new Request('http://localhost:3001/api/session/login', {
    method: 'POST',
  }) as unknown as NextRequest;

  it('deuxième étape demandée : relayée telle quelle, aucun cookie de session', async () => {
    const challenge = { twoFactor: 'VERIFY', challengeToken: 'x'.repeat(43), expiresIn: 600 };
    const response = await finishSession(request, Response.json(challenge));
    expect(await response.json()).toEqual(challenge);
    expect(response.cookies.get(REFRESH_COOKIE)).toBeUndefined();
  });

  it('session : cookie posé, refresh token jamais renvoyé au navigateur', async () => {
    const session = {
      tokenType: 'Bearer',
      accessToken: 'access',
      expiresIn: 900,
      refreshToken: 'refresh-secret',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        phone: '+212600000001',
        email: null,
        firstName: 'Super',
        lastName: 'Admin',
        locale: 'fr',
        isSuperAdmin: true,
        hasPassword: true,
        twoFactorEnabled: true,
      },
      context: { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' },
    };
    const response = await finishSession(request, Response.json(session));
    expect(JSON.stringify(await response.json())).not.toContain('refresh-secret');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('refresh-secret');
  });
});
