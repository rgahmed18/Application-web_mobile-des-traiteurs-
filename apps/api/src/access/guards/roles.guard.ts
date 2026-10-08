import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../auth/decorators';
import { appErrors } from '../../common/errors';
import type { Role } from '../../generated/prisma/client';
import { getMetadata, getRequest, isPublicRoute, requireUser } from './guard-utils';

/** 3e guard : rôles autorisés via @Roles(...). Le SUPER_ADMIN passe toujours. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    const roles = getMetadata<Role[]>(this.reflector, ROLES_KEY, context);
    if (!roles || roles.length === 0) return true;

    const user = requireUser(getRequest(context));
    if (user.isSuperAdmin || roles.includes(user.role)) return true;
    throw appErrors.forbidden('FORBIDDEN_ROLE', 'Votre rôle ne permet pas cette action');
  }
}
