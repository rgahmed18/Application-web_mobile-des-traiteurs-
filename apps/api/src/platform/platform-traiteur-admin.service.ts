import { Injectable } from '@nestjs/common';
import {
  FEATURE_KEYS,
  type FeatureKey,
  getDefaultFeatureFlags,
  PLAN_FEATURES,
  type PlatformPlanChangeInput,
  type PlatformTraiteurDetail,
  zonedDayRange,
} from '@traiteur/shared';

import { FeaturesService } from '../access/features.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SpacesService } from '../spaces/spaces.service';
import { PlatformTraiteursService } from './platform-traiteurs.service';

type Tx = Prisma.TransactionClient;
const PLATFORM_TIMEZONE = 'Africa/Casablanca';

/** Actions de la plateforme affichées dans l'historique de la fiche d'un traiteur. */
const HISTORY_ACTIONS = [
  'traiteur.created',
  'platform.traiteur_created',
  'platform.admin_invitation_resent',
  'platform.plan_changed',
  'platform.feature_toggled',
  'platform.traiteur_suspended',
  'platform.traiteur_reactivated',
  'platform.trial_updated',
  'platform.subscription_activated',
  // Entrées et sorties du super admin chez le traiteur (le détail des requêtes reste dans l'audit)
  'platform.access_started',
  'platform.access_extended',
  'platform.access_ended',
  'platform.domain_added',
  'platform.domain_verified',
  'platform.domain_disabled',
  'platform.domain_removed',
];

/**
 * Fiche d'un traiteur dans la console : offre, fonctionnalités, essai, suspension (motif) et
 * réactivation. Chaque changement est tracé dans le journal d'audit du traiteur, avec l'avant et
 * l'après ; le cache des fonctionnalités est vidé aussitôt.
 */
@Injectable()
export class PlatformTraiteurAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly features: FeaturesService,
    private readonly traiteurs: PlatformTraiteursService,
    private readonly spaces: SpacesService,
  ) {}

  async detail(traiteurId: string): Promise<PlatformTraiteurDetail> {
    const base = await this.traiteurs.get(traiteurId);
    const [row, flags, history] = await Promise.all([
      this.prisma.traiteur.findUniqueOrThrow({
        where: { id: traiteurId },
        select: { suspendedAt: true, suspensionReason: true },
      }),
      this.prisma.featureFlag.findMany({
        where: { traiteurId },
        select: { key: true, enabled: true },
      }),
      this.prisma.auditLog.findMany({
        where: { traiteurId, action: { in: HISTORY_ACTIONS } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          action: true,
          after: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    const included = new Set<string>(PLAN_FEATURES[base.plan]);
    const enabled = new Set(flags.filter((flag) => flag.enabled).map((flag) => flag.key));
    return {
      ...base,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      suspensionReason: row.suspensionReason,
      features: FEATURE_KEYS.map((key) => ({
        key,
        enabled: enabled.has(key),
        includedInPlan: included.has(key),
      })),
      history: history.map((entry) => {
        const after = (entry.after ?? {}) as { reason?: unknown };
        return {
          id: entry.id,
          at: entry.createdAt.toISOString(),
          action: entry.action,
          actorName: entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}`.trim() : null,
          reason: typeof after.reason === 'string' ? after.reason : null,
        };
      }),
    };
  }

  async changePlan(
    user: AuthenticatedUser,
    traiteurId: string,
    input: PlatformPlanChangeInput,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, traiteurId);
      await tx.traiteur.update({ where: { id: traiteurId }, data: { plan: input.plan } });
      if (input.applyPlanFeatures) {
        for (const flag of getDefaultFeatureFlags(input.plan)) {
          await tx.featureFlag.upsert({
            where: { traiteurId_key: { traiteurId, key: flag.key } },
            update: { enabled: flag.enabled },
            create: { traiteurId, key: flag.key, enabled: flag.enabled },
          });
        }
      }
      await this.record(tx, user, traiteurId, 'platform.plan_changed', client, {
        before: { plan: before.plan },
        after: { plan: input.plan, applyPlanFeatures: input.applyPlanFeatures },
      });
    });
    await this.features.invalidate(traiteurId);
    // Domaine personnalisé servi ou non selon la fonctionnalité : effet immédiat
    this.spaces.invalidate();
    return this.detail(traiteurId);
  }

  async toggleFeature(
    user: AuthenticatedUser,
    traiteurId: string,
    key: FeatureKey,
    enabled: boolean,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, traiteurId);
      const previous = await tx.featureFlag.findUnique({
        where: { traiteurId_key: { traiteurId, key } },
        select: { enabled: true },
      });
      await tx.featureFlag.upsert({
        where: { traiteurId_key: { traiteurId, key } },
        update: { enabled },
        create: { traiteurId, key, enabled },
      });
      await this.record(tx, user, traiteurId, 'platform.feature_toggled', client, {
        before: { key, enabled: previous?.enabled ?? false },
        after: { key, enabled },
      });
    });
    await this.features.invalidate(traiteurId);
    // Domaine personnalisé servi ou non selon la fonctionnalité : effet immédiat
    this.spaces.invalidate();
    return this.detail(traiteurId);
  }

  /** Suspension (impayé…) : plus aucun accès, dès la requête suivante ; motif conservé. */
  async suspend(
    user: AuthenticatedUser,
    traiteurId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, traiteurId);
      if (before.status === 'SUSPENDED') {
        throw appErrors.conflict('TRAITEUR_ALREADY_SUSPENDED', 'Ce traiteur est déjà suspendu');
      }
      await tx.traiteur.update({
        where: { id: traiteurId },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason },
      });
      await this.record(tx, user, traiteurId, 'platform.traiteur_suspended', client, {
        before: { status: before.status },
        after: { status: 'SUSPENDED', reason },
      });
    });
    return this.detail(traiteurId);
  }

  /** Réactivation : essai si sa fin n'est pas passée, sinon abonnement actif. */
  async reactivate(
    user: AuthenticatedUser,
    traiteurId: string,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, traiteurId);
      if (before.status !== 'SUSPENDED') {
        throw appErrors.conflict('TRAITEUR_NOT_SUSPENDED', 'Ce traiteur n’est pas suspendu');
      }
      const status = before.trialEndsAt && before.trialEndsAt > new Date() ? 'TRIAL' : 'ACTIVE';
      await tx.traiteur.update({
        where: { id: traiteurId },
        data: { status, suspendedAt: null, suspensionReason: null },
      });
      await this.record(tx, user, traiteurId, 'platform.traiteur_reactivated', client, {
        before: { status: before.status, reason: before.suspensionReason },
        after: { status },
      });
    });
    return this.detail(traiteurId);
  }

  /** Fin de l'essai : prolongée ou raccourcie (traiteur en essai seulement). */
  async updateTrial(
    user: AuthenticatedUser,
    traiteurId: string,
    trialEndsOn: string,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, traiteurId);
      if (before.status !== 'TRIAL') {
        throw appErrors.badRequest('TRAITEUR_NOT_IN_TRIAL', 'Ce traiteur n’est pas en essai');
      }
      // Jusqu'à la fin du jour choisi (dernière milliseconde, fuseau du Maroc)
      const trialEndsAt = new Date(zonedDayRange(trialEndsOn, PLATFORM_TIMEZONE).end.getTime() - 1);
      await tx.traiteur.update({ where: { id: traiteurId }, data: { trialEndsAt } });
      await this.record(tx, user, traiteurId, 'platform.trial_updated', client, {
        before: { trialEndsAt: before.trialEndsAt?.toISOString() ?? null },
        after: { trialEndsAt: trialEndsAt.toISOString() },
      });
    });
    return this.detail(traiteurId);
  }

  /** Fin de l'essai avant terme : abonnement actif tout de suite. */
  async activateSubscription(
    user: AuthenticatedUser,
    traiteurId: string,
    client: ClientInfo,
  ): Promise<PlatformTraiteurDetail> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, traiteurId);
      if (before.status !== 'TRIAL') {
        throw appErrors.badRequest('TRAITEUR_NOT_IN_TRIAL', 'Ce traiteur n’est pas en essai');
      }
      await tx.traiteur.update({
        where: { id: traiteurId },
        data: { status: 'ACTIVE', trialEndsAt: null },
      });
      await this.record(tx, user, traiteurId, 'platform.subscription_activated', client, {
        before: { status: 'TRIAL', trialEndsAt: before.trialEndsAt?.toISOString() ?? null },
        after: { status: 'ACTIVE' },
      });
    });
    return this.detail(traiteurId);
  }

  // ─────────────────────────── Interne ───────────────────────────

  /** Verrouille le traiteur (changements concurrents sérialisés) et retourne son état. */
  private async lock(tx: Tx, traiteurId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Traiteur" WHERE "id" = ${traiteurId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Traiteur introuvable');
    return tx.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { plan: true, status: true, trialEndsAt: true, suspensionReason: true },
    });
  }

  private record(
    tx: Tx,
    user: AuthenticatedUser,
    traiteurId: string,
    action: string,
    client: ClientInfo,
    change: { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue },
  ): Promise<void> {
    return this.audit.record(
      {
        traiteurId,
        actor: user,
        action,
        entityType: 'Traiteur',
        entityId: traiteurId,
        before: change.before,
        after: change.after,
        client,
      },
      tx,
    );
  }
}
