import { Injectable } from '@nestjs/common';
import {
  PLAN_FEATURES,
  type PlatformPlans,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import type { ClientInfo } from '../common/http/client-info';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformDashboardService } from './platform-dashboard.service';

/**
 * Offres de la plateforme : prix mensuel (modifiable, historique conservé : chaque changement
 * est une nouvelle ligne en vigueur dès maintenant), fonctionnalités incluses, nombre de
 * traiteurs par offre.
 */
@Injectable()
export class PlatformPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dashboards: PlatformDashboardService,
  ) {}

  async plans(): Promise<PlatformPlans> {
    const [prices, history, counts] = await Promise.all([
      this.dashboards.currentPlanPrices(),
      this.prisma.platformPlanPrice.findMany({
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        take: 60,
      }),
      this.prisma.traiteur.groupBy({
        by: ['plan'],
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        _count: { _all: true },
      }),
    ]);
    const creatorIds = [
      ...new Set(history.flatMap((row) => (row.createdById ? [row.createdById] : []))),
    ];
    const creators = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
    );
    return {
      currency: 'MAD',
      plans: SUBSCRIPTION_PLANS.map((plan) => ({
        plan,
        monthlyPrice: prices[plan],
        features: [...PLAN_FEATURES[plan]],
        traiteurs: counts.find((row) => row.plan === plan)?._count._all ?? 0,
        history: history
          .filter((row) => row.plan === plan)
          .map((row) => ({
            monthlyPrice: row.monthlyPrice,
            effectiveFrom: row.effectiveFrom.toISOString(),
            createdBy: row.createdById ? (creators.get(row.createdById) ?? null) : null,
          })),
      })),
    };
  }

  /** Nouveau prix en vigueur dès maintenant ; l'ancien reste dans l'historique. */
  async setPrice(
    user: AuthenticatedUser,
    plan: SubscriptionPlan,
    monthlyPrice: number,
    client: ClientInfo,
  ): Promise<PlatformPlans> {
    const before = (await this.dashboards.currentPlanPrices())[plan];
    await this.prisma.$transaction(async (tx) => {
      await tx.platformPlanPrice.create({
        data: { plan, monthlyPrice, createdById: user.userId },
      });
      await this.audit.record(
        {
          traiteurId: null,
          actor: user,
          action: 'platform.plan_price_changed',
          entityType: 'PlatformPlanPrice',
          entityId: null,
          before: { plan, monthlyPrice: before },
          after: { plan, monthlyPrice },
          client,
        },
        tx,
      );
    });
    return this.plans();
  }
}
