import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { getRequest, requireUser } from '../access/guards/guard-utils';
import { appErrors } from '../common/errors';

/**
 * Console de la plateforme : SUPER_ADMIN en session plateforme uniquement. Refusée à tout autre
 * rôle, et au super admin lorsqu'il est entré chez un traiteur (session limitée à ce traiteur).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = requireUser(getRequest(context));
    if (user.isSuperAdmin && user.role === 'SUPER_ADMIN' && user.traiteurId === null) return true;
    throw appErrors.forbidden('PLATFORM_ONLY', 'Réservé à la console de la plateforme');
  }
}
