import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi } from './bff';

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
