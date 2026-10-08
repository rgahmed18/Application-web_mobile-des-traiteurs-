import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest, AuthenticatedUser } from '../../auth/auth-user';
import { IS_PUBLIC_KEY } from '../../auth/decorators';

export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}

export function getMetadata<T>(
  reflector: Reflector,
  key: string,
  context: ExecutionContext,
): T | undefined {
  return reflector.getAllAndOverride<T | undefined>(key, [
    context.getHandler(),
    context.getClass(),
  ]);
}

export function getRequest(context: ExecutionContext): AuthenticatedRequest {
  return context.switchToHttp().getRequest<AuthenticatedRequest>();
}

/** Utilisateur posé par JwtAuthGuard ; son absence ici est une erreur de configuration. */
export function requireUser(request: AuthenticatedRequest): AuthenticatedUser {
  if (!request.user) throw new UnauthorizedException();
  return request.user;
}
