import { Injectable } from '@nestjs/common';
import {
  type PlatformTraiteur,
  type PlatformTraiteurCreateInput,
  type PlatformTraiteurCreateResult,
  type PlatformTraiteurListQuery,
  type PlatformTraiteurPage,
  todayInTimeZone,
  zonedDayRange,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { newLinkToken } from '../common/link-token';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffService } from '../staff/staff.service';
import { ADMIN_INVITATION_TTL_MS, ProvisionError, provisionTraiteur } from './provision-traiteur';

const PLATFORM_TIMEZONE = 'Africa/Casablanca';
const DAY_MS = 86_400_000;

const traiteurSelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  email: true,
  phone: true,
  plan: true,
  status: true,
  trialEndsAt: true,
  createdAt: true,
  memberships: {
    where: { role: 'ADMIN_TRAITEUR' },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      user: { select: { phone: true } },
      invitations: {
        where: { usedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { expiresAt: true },
      },
    },
  },
} satisfies Prisma.TraiteurSelect;
type TraiteurRow = Prisma.TraiteurGetPayload<{ select: typeof traiteurSelect }>;

/**
 * Traiteurs de la plateforme : liste (identité, offre, statut, activité du mois, premier
 * administrateur), création en essai, nouveau lien d'activation de l'administrateur. Jamais de
 * donnée des clients d'un traiteur.
 */
@Injectable()
export class PlatformTraiteursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly staff: StaffService,
  ) {}

  async list(query: PlatformTraiteurListQuery): Promise<PlatformTraiteurPage> {
    const search = query.search?.trim();
    const where: Prisma.TraiteurWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.plan ? { plan: query.plan } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search.toLowerCase() } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.traiteur.count({ where }),
      this.prisma.traiteur.findMany({
        where,
        select: traiteurSelect,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const orders = await this.ordersThisMonth(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toTraiteur(row, orders.get(row.id) ?? 0)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    user: AuthenticatedUser,
    input: PlatformTraiteurCreateInput,
    client: ClientInfo,
  ): Promise<PlatformTraiteurCreateResult> {
    const created = await this.prisma
      .$transaction(async (tx) => {
        const result = await provisionTraiteur(tx, {
          slug: input.slug,
          name: input.name,
          email: input.email,
          phone: input.phone,
          city: input.city,
          plan: input.plan,
          locale: input.locale,
          status: input.trialDays > 0 ? 'TRIAL' : 'ACTIVE',
          trialEndsAt: input.trialDays > 0 ? new Date(Date.now() + input.trialDays * DAY_MS) : null,
          admin: input.admin,
        });
        await this.audit.record(
          {
            traiteurId: result.traiteur.id,
            actor: user,
            action: 'platform.traiteur_created',
            entityType: 'Traiteur',
            entityId: result.traiteur.id,
            after: {
              slug: input.slug,
              plan: input.plan,
              trialDays: input.trialDays,
              adminMembershipId: result.membershipId,
            },
            client,
          },
          tx,
        );
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof ProvisionError) {
          throw error.code === 'SLUG_TAKEN'
            ? appErrors.conflict('SLUG_TAKEN', error.message)
            : appErrors.badRequest('ADMIN_IS_SUPER_ADMIN', error.message);
        }
        throw error;
      });
    const link = await this.staff.deliverInvitation(
      created.traiteur.id,
      created.membershipId,
      created.token,
      created.expiresAt,
    );
    return { traiteur: await this.get(created.traiteur.id), link };
  }

  /** Nouveau lien d'activation pour le premier administrateur (le précédent est révoqué). */
  async resendAdminInvitation(
    user: AuthenticatedUser,
    traiteurId: string,
    client: ClientInfo,
  ): Promise<PlatformTraiteurCreateResult> {
    const { membershipId, token, expiresAt } = await this.prisma.$transaction(async (tx) => {
      const admin = await tx.membership.findFirst({
        where: { traiteurId, role: 'ADMIN_TRAITEUR' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true },
      });
      if (!admin) throw appErrors.notFound('NOT_FOUND', 'Traiteur ou administrateur introuvable');
      if (admin.status !== 'INVITED') {
        throw appErrors.conflict(
          'ADMIN_ALREADY_ACTIVE',
          'L’administrateur a déjà activé son accès : il peut utiliser « Mot de passe oublié ».',
        );
      }
      const now = new Date();
      await tx.staffInvitation.updateMany({
        where: { membershipId: admin.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const { token: newToken, hash } = newLinkToken();
      const newExpiresAt = new Date(now.getTime() + ADMIN_INVITATION_TTL_MS);
      await tx.staffInvitation.create({
        data: { traiteurId, membershipId: admin.id, tokenHash: hash, expiresAt: newExpiresAt },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'platform.admin_invitation_resent',
          entityType: 'Membership',
          entityId: admin.id,
          client,
        },
        tx,
      );
      return { membershipId: admin.id, token: newToken, expiresAt: newExpiresAt };
    });
    const link = await this.staff.deliverInvitation(traiteurId, membershipId, token, expiresAt);
    return { traiteur: await this.get(traiteurId), link };
  }

  async get(traiteurId: string): Promise<PlatformTraiteur> {
    const row = await this.prisma.traiteur.findUnique({
      where: { id: traiteurId },
      select: traiteurSelect,
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Traiteur introuvable');
    const orders = await this.ordersThisMonth([row.id]);
    return this.toTraiteur(row, orders.get(row.id) ?? 0);
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async ordersThisMonth(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const today = todayInTimeZone(PLATFORM_TIMEZONE);
    const start = zonedDayRange(`${today.slice(0, 7)}-01`, PLATFORM_TIMEZONE).start;
    const rows = await this.prisma.order.groupBy({
      by: ['traiteurId'],
      where: { traiteurId: { in: [...ids] }, createdAt: { gte: start } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.traiteurId, row._count._all]));
  }

  private toTraiteur(row: TraiteurRow, ordersThisMonth: number): PlatformTraiteur {
    const admin = row.memberships[0];
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      email: row.email,
      phone: row.phone,
      plan: row.plan,
      status: row.status,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      ordersThisMonth,
      admin: admin
        ? {
            membershipId: admin.id,
            firstName: admin.firstName,
            lastName: admin.lastName,
            phone: admin.user.phone,
            status: admin.status,
            invitationExpiresAt:
              admin.status === 'INVITED'
                ? (admin.invitations[0]?.expiresAt.toISOString() ?? null)
                : null,
          }
        : null,
    };
  }
}
