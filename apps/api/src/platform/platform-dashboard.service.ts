import { Injectable } from '@nestjs/common';
import {
  addDays,
  type PlatformDashboard,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  TRIAL_ENDING_SOON_DAYS,
  todayInTimeZone,
  zonedDayRange,
} from '@traiteur/shared';

import { PrismaService } from '../prisma/prisma.service';

/** Fuseau de la plateforme pour les bornes de mois (comme les traiteurs marocains). */
const PLATFORM_TIMEZONE = 'Africa/Casablanca';
const PLATFORM_CURRENCY = 'MAD';
const DAY_MS = 86_400_000;

/** Premier jour du mois (AAAA-MM-01) décalé de `offset` mois. */
function monthStart(today: string, offset: number): string {
  const [year = 0, month = 1] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Tableau de bord de la plateforme : nombres de traiteurs par statut, commandes du mois tous
 * traiteurs confondus, abonnements estimés, essais qui se terminent, activité par traiteur et
 * dernières actions de la plateforme. Aucune donnée de client n'en sort.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prix mensuel en vigueur de chaque offre (dernière date d'effet passée). */
  async currentPlanPrices(now = new Date()): Promise<Record<SubscriptionPlan, number>> {
    const rows = await this.prisma.platformPlanPrice.findMany({
      where: { effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const prices = { BASIQUE: 0, PRO: 0, PREMIUM: 0 } as Record<SubscriptionPlan, number>;
    for (const plan of SUBSCRIPTION_PLANS) {
      prices[plan] = rows.find((row) => row.plan === plan)?.monthlyPrice ?? 0;
    }
    return prices;
  }

  async dashboard(now = new Date()): Promise<PlatformDashboard> {
    const today = todayInTimeZone(PLATFORM_TIMEZONE, now);
    const thisMonth = zonedDayRange(monthStart(today, 0), PLATFORM_TIMEZONE).start;
    const lastMonth = zonedDayRange(monthStart(today, -1), PLATFORM_TIMEZONE).start;
    const trialLimit = zonedDayRange(addDays(today, TRIAL_ENDING_SOON_DAYS), PLATFORM_TIMEZONE).end;

    const [byStatus, activeByPlan, ordersThisMonth, ordersLastMonth, trials, activity, prices] =
      await Promise.all([
        this.prisma.traiteur.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.traiteur.groupBy({
          by: ['plan'],
          where: { status: 'ACTIVE' },
          _count: { _all: true },
        }),
        this.prisma.order.count({ where: { createdAt: { gte: thisMonth } } }),
        this.prisma.order.count({ where: { createdAt: { gte: lastMonth, lt: thisMonth } } }),
        this.prisma.traiteur.findMany({
          where: { status: 'TRIAL', trialEndsAt: { not: null, lte: trialLimit } },
          select: { id: true, name: true, city: true, plan: true, trialEndsAt: true },
          orderBy: { trialEndsAt: 'asc' },
          take: 10,
        }),
        this.prisma.order.groupBy({
          by: ['traiteurId'],
          where: { createdAt: { gte: thisMonth } },
          _count: { _all: true },
        }),
        this.currentPlanPrices(now),
      ]);

    const count = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const estimatedMonthlyRevenue = activeByPlan.reduce(
      (total, row) => total + row._count._all * prices[row.plan],
      0,
    );

    // Activité par traiteur : tous les traiteurs non résiliés, les plus actifs d'abord
    const ordersByTraiteur = new Map(activity.map((row) => [row.traiteurId, row._count._all]));
    const traiteurs = await this.prisma.traiteur.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true, name: true, city: true, plan: true, status: true },
    });
    const traiteurActivity = traiteurs
      .map((row) => ({ ...row, ordersThisMonth: ordersByTraiteur.get(row.id) ?? 0 }))
      .sort((a, b) => b.ordersThisMonth - a.ordersThisMonth || a.name.localeCompare(b.name))
      .slice(0, 10);

    return {
      traiteurs: {
        active: count('ACTIVE'),
        trial: count('TRIAL'),
        suspended: count('SUSPENDED'),
        cancelled: count('CANCELLED'),
      },
      ordersThisMonth,
      ordersLastMonth,
      estimatedMonthlyRevenue,
      currency: PLATFORM_CURRENCY,
      planPrices: prices,
      trialsEndingSoon: trials.flatMap((row) =>
        row.trialEndsAt
          ? [
              {
                id: row.id,
                name: row.name,
                city: row.city,
                plan: row.plan,
                trialEndsAt: row.trialEndsAt.toISOString(),
                daysLeft: Math.max(
                  0,
                  Math.ceil((row.trialEndsAt.getTime() - now.getTime()) / DAY_MS),
                ),
              },
            ]
          : [],
      ),
      traiteurActivity,
      recentActions: await this.recentActions(),
    };
  }

  /** Actions de la plateforme : celles d'un super admin et celles des commandes serveur. */
  private async recentActions(): Promise<PlatformDashboard['recentActions']> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { actorRole: 'SUPER_ADMIN' },
          { action: { startsWith: 'super_admin.' } },
          { action: { startsWith: 'platform.' } },
          { action: 'traiteur.created' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        action: true,
        traiteur: { select: { name: true } },
        actor: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      traiteurName: row.traiteur?.name ?? null,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
    }));
  }
}
