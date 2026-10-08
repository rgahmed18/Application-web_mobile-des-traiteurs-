import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { toAuthenticatedUser } from '../../auth/auth-user';
import { TokenService } from '../../auth/token.service';
import { appErrors } from '../../common/errors';
import { getRequest, isPublicRoute } from './guard-utils';

/** 1er guard : vérifie le JWT (header Authorization: Bearer) et attache l'utilisateur. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const request = getRequest(context);
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw appErrors.unauthorized('INVALID_TOKEN', 'Authentification requise');
    }

    request.user = toAuthenticatedUser(await this.tokens.verifyAccessToken(token));
    return true;
  }
}
