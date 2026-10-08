import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { appErrors } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequest, isPublicRoute, requireUser } from './guard-utils';

const UNAVAILABLE_TRAITEUR_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/**
 * 2e guard : isolation multi-tenant.
 * - Le traiteurId vient TOUJOURS du jeton, jamais du client.
 * - Le Membership est revérifié en base à chaque requête : une suspension ou un changement
 *   de rôle prend effet immédiatement, sans attendre l'expiration du jeton.
 * - Un paramètre de route :traiteurId doit correspondre au traiteur du jeton.
 * - Le SUPER_ADMIN n'est pas soumis à ces contrôles.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const request = getRequest(context);
    const user = requireUser(request);

    if (user.isSuperAdmin) {
      const superAdmin = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { status: true, isSuperAdmin: true },
      });
      if (!superAdmin?.isSuperAdmin || superAdmin.status !== 'ACTIVE') {
        throw appErrors.forbidden('ACCOUNT_DISABLED', 'Compte désactivé');
      }
      return true;
    }

    if (!user.traiteurId || !user.membershipId) {
      throw appErrors.forbidden('TRAITEUR_REQUIRED', 'Aucun traiteur actif dans la session');
    }

    const routeTraiteurId = request.params.traiteurId;
    if (typeof routeTraiteurId === 'string' && routeTraiteurId !== user.traiteurId) {
      throw appErrors.forbidden('TENANT_MISMATCH', 'Accès refusé à ce traiteur');
    }

    const membership = await this.prisma.membership.findFirst({
      where: { id: user.membershipId, userId: user.userId, traiteurId: user.traiteurId },
      select: {
        role: true,
        status: true,
        user: { select: { status: true } },
        traiteur: { select: { status: true } },
      },
    });

    if (!membership || membership.user.status !== 'ACTIVE') {
      throw appErrors.forbidden('ACCOUNT_DISABLED', 'Compte désactivé');
    }
    if (membership.status !== 'ACTIVE' || membership.role !== user.role) {
      throw appErrors.forbidden('MEMBERSHIP_INACTIVE', 'Accès révoqué, reconnectez-vous');
    }
    if (UNAVAILABLE_TRAITEUR_STATUSES.has(membership.traiteur.status)) {
      throw appErrors.forbidden(
        'TRAITEUR_UNAVAILABLE',
        'Ce traiteur est actuellement indisponible',
      );
    }
    return true;
  }
}
