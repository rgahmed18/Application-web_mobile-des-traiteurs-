import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi, finishSession, REFRESH_COOKIE, sessionMatchesSpace } from './bff';

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
    const response = await finishSession(request, Response.json(session), { kind: 'platform' });
    expect(JSON.stringify(await response.json())).not.toContain('refresh-secret');
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe('refresh-secret');
  });
});

describe('sessionMatchesSpace : une session ne vaut que pour l’espace de son adresse', () => {
  const darDiafa = {
    kind: 'traiteur' as const,
    traiteur: {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'dar-diafa',
      name: 'Dar Diafa',
      logoUrl: null,
      status: 'ACTIVE' as const,
    },
  };
  const staff = (traiteurId: string | null, role: 'ADMIN_TRAITEUR' | 'SUPER_ADMIN' | 'CLIENT') => ({
    traiteurId,
    membershipId: role === 'SUPER_ADMIN' ? null : '33333333-3333-4333-8333-333333333333',
    role,
  });

  it('adresse d’un traiteur : seulement son personnel', () => {
    expect(sessionMatchesSpace(staff(darDiafa.traiteur.id, 'ADMIN_TRAITEUR'), darDiafa)).toBe(true);
    expect(
      sessionMatchesSpace(
        staff('44444444-4444-4444-8444-444444444444', 'ADMIN_TRAITEUR'),
        darDiafa,
      ),
    ).toBe(false);
    expect(sessionMatchesSpace(staff(darDiafa.traiteur.id, 'CLIENT'), darDiafa)).toBe(false);
    expect(sessionMatchesSpace(staff(darDiafa.traiteur.id, 'SUPER_ADMIN'), darDiafa)).toBe(false);
  });

  it('adresse de la console : seulement le super admin (console ou entré chez un traiteur)', () => {
    const platform = { kind: 'platform' as const };
    expect(sessionMatchesSpace(staff(null, 'SUPER_ADMIN'), platform)).toBe(true);
    expect(sessionMatchesSpace(staff(darDiafa.traiteur.id, 'SUPER_ADMIN'), platform)).toBe(true);
    expect(sessionMatchesSpace(staff(darDiafa.traiteur.id, 'ADMIN_TRAITEUR'), platform)).toBe(
      false,
    );
  });
});
