import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { FeatureKey, PermissionKey } from '@traiteur/shared';

import type { Role } from '../generated/prisma/client';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-user';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';
export const FEATURE_KEY = 'auth:feature';

/** Route accessible sans authentification. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restreint la route à certains rôles (le SUPER_ADMIN passe toujours). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Exige toutes les permissions listées (lues en base, par rôle et par traiteur). */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige qu'une fonctionnalité soit activée pour le traiteur (offre Basique / Pro / Premium). */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);

/** Injecte l'utilisateur authentifié dans un handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new UnauthorizedException();
    return request.user;
  },
);
