import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth-user';

/** Contexte d'exécution HTTP minimal pour tester les guards. */
export function createHttpContext(
  request: Partial<AuthenticatedRequest> & { user?: AuthenticatedUser },
): ExecutionContext {
  const fullRequest = { headers: {}, params: {}, ...request };
  const handler = () => undefined;
  class TestController {}
  return {
    switchToHttp: () => ({
      getRequest: () => fullRequest,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

/** Reflector qui retourne des métadonnées fixées par clé. */
export function createReflector(metadata: Record<string, unknown>): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => metadata[String(key)]);
  return reflector;
}

export function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    traiteurId: '22222222-2222-4222-8222-222222222222',
    membershipId: '33333333-3333-4333-8333-333333333333',
    role: 'EMPLOYE',
    isSuperAdmin: false,
    ...overrides,
  };
}
