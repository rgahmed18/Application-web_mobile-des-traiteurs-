import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY } from '../../auth/decorators';
import { appErrors } from '../../common/errors';
import { PermissionsService } from '../permissions.service';
import { getMetadata, getRequest, isPublicRoute, requireUser } from './guard-utils';

/** 4e guard : permissions exigées via @RequirePermissions(...), lues en base. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;
    const required = getMetadata<string[]>(this.reflector, PERMISSIONS_KEY, context);
    if (!required || required.length === 0) return true;

    const user = requireUser(getRequest(context));
    if (user.isSuperAdmin) return true;
    if (await this.permissions.hasAll(user.traiteurId, user.role, required)) return true;
    throw appErrors.forbidden('MISSING_PERMISSION', 'Permission insuffisante');
  }
}
