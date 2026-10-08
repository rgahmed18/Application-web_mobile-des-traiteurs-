import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@traiteur/shared';

import { FEATURE_KEY } from '../../auth/decorators';
import { appErrors } from '../../common/errors';
import { FeaturesService } from '../features.service';
import { getMetadata, getRequest, isPublicRoute, requireUser } from './guard-utils';

/** 5e guard : fonctionnalité de l'offre exigée via @RequireFeature(...). */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;
    const feature = getMetadata<FeatureKey>(this.reflector, FEATURE_KEY, context);
    if (!feature) return true;

    const user = requireUser(getRequest(context));
    if (user.isSuperAdmin && !user.traiteurId) return true;
    if (user.traiteurId && (await this.features.isEnabled(user.traiteurId, feature))) return true;
    throw appErrors.forbidden(
      'FEATURE_DISABLED',
      "Cette fonctionnalité n'est pas incluse dans votre offre",
    );
  }
}
