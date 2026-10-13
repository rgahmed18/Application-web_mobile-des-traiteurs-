import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type InvitationLink,
  STAFF_ROLES,
  type StaffInviteInput,
  type StaffInviteResult,
  type StaffListQuery,
  type StaffMember,
  type StaffMemberRole,
  type StaffSuspendInput,
  type StaffUpdateInput,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { SMS_PROVIDER, type SmsProvider } from '../auth/otp/sms.provider';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { newLinkToken } from '../common/link-token';
import { requireTraiteurId } from '../common/tenant';
import type { Env } from '../config/env.schema';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient;

/** Durée de validité d'un lien d'activation. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const memberInclude = {
  user: { select: { phone: true, lastLoginAt: true, passwordHash: true } },
  invitations: {
    where: { usedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true, smsSent: true },
  },
} satisfies Prisma.MembershipInclude;
type MemberRow = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;

const STATUS_ORDER = { ACTIVE: 0, INVITED: 1, SUSPENDED: 2 } as const;

const ROLE_LABELS: Record<StaffMemberRole, { fr: string; ar: string }> = {
  ADMIN_TRAITEUR: { fr: 'administrateur', ar: 'مسؤول' },
  EMPLOYE: { fr: 'employé (bureau)', ar: 'موظف (المكتب)' },
  EQUIPE: { fr: 'membre de l’équipe', ar: 'عضو في الفريق' },
  LIVREUR: { fr: 'livreur', ar: 'سائق التوصيل' },
};

/**
 * Personnel du traiteur : invitation par lien d'activation (SMS si le pays est autorisé, lien
 * toujours affiché une fois à l'administrateur), modification, suspension et réactivation.
 *
 * Garde-fous : on n'agit pas sur soi-même (rôle, suspension), le dernier administrateur actif
 * reste administrateur, et seul un administrateur nomme un administrateur.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);
  private readonly webUrl: string;
  private readonly smsCountries: readonly string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('PUBLIC_WEB_URL', { infer: true }).replace(/\/+$/, '');
    this.smsCountries = config.get('SMS_ALLOWED_COUNTRY_CODES', { infer: true });
  }

  async list(user: AuthenticatedUser, query: StaffListQuery): Promise<StaffMember[]> {
    const traiteurId = requireTraiteurId(user);
    const search = query.search?.trim();
    const rows = await this.prisma.membership.findMany({
      where: {
        traiteurId,
        role: query.role ?? { in: [...STAFF_ROLES] },
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { user: { phone: { contains: search.replace(/\s/g, '') } } },
              ],
            }
          : {}),
      },
      include: memberInclude,
    });
    return rows
      .map((row) => this.toMember(row, user))
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.lastName.localeCompare(b.lastName, 'fr') ||
          a.firstName.localeCompare(b.firstName, 'fr'),
      );
  }

  async invite(
    user: AuthenticatedUser,
    input: StaffInviteInput,
    client: ClientInfo,
  ): Promise<StaffInviteResult> {
    const traiteurId = requireTraiteurId(user);
    this.assertCanGrant(user, input.role);
    const { membershipId, token, expiresAt } = await this.prisma.$transaction(async (tx) => {
      const account =
        (await tx.user.findUnique({ where: { phone: input.phone } })) ??
        (await tx.user.create({
          data: {
            phone: input.phone,
            firstName: input.firstName,
            lastName: input.lastName,
            locale: input.locale,
          },
        }));
      const existing = await tx.membership.findUnique({
        where: { userId_traiteurId: { userId: account.id, traiteurId } },
        select: { id: true, role: true },
      });
      if (existing?.role === 'CLIENT') {
        throw appErrors.conflict('PHONE_IS_CLIENT', 'Ce numéro appartient à un de vos clients');
      }
      if (existing) {
        throw appErrors.conflict('MEMBER_EXISTS', 'Ce numéro fait déjà partie de votre équipe', {
          memberId: existing.id,
        });
      }
      const membership = await tx.membership.create({
        data: {
          traiteurId,
          userId: account.id,
          role: input.role,
          status: 'INVITED',
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
        },
      });
      const invitation = await this.createInvitation(tx, traiteurId, membership.id);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.invited',
          entityType: 'Membership',
          entityId: membership.id,
          after: { role: input.role, firstName: input.firstName, lastName: input.lastName },
          client,
        },
        tx,
      );
      return { membershipId: membership.id, ...invitation };
    });
    const link = await this.deliver(traiteurId, membershipId, token, expiresAt);
    return { member: await this.get(user, membershipId), link };
  }

  /** Nouveau lien d'activation (le précédent est révoqué). */
  async renewInvitation(
    user: AuthenticatedUser,
    memberId: string,
    client: ClientInfo,
  ): Promise<StaffInviteResult> {
    const traiteurId = requireTraiteurId(user);
    const { token, expiresAt } = await this.prisma.$transaction(async (tx) => {
      const member = await this.lockMember(tx, traiteurId, memberId);
      if (member.status !== 'INVITED') {
        throw appErrors.badRequest('MEMBER_NOT_INVITED', 'Ce membre a déjà activé son accès');
      }
      this.assertCanGrant(user, member.role);
      await this.revokeInvitations(tx, memberId);
      const invitation = await this.createInvitation(tx, traiteurId, memberId);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.invitation_renewed',
          entityType: 'Membership',
          entityId: memberId,
          client,
        },
        tx,
      );
      return invitation;
    });
    const link = await this.deliver(traiteurId, memberId, token, expiresAt);
    return { member: await this.get(user, memberId), link };
  }

  /** Annule une invitation jamais activée : le membre est retiré de l'équipe. */
  async cancelInvitation(
    user: AuthenticatedUser,
    memberId: string,
    client: ClientInfo,
  ): Promise<void> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const member = await this.lockMember(tx, traiteurId, memberId);
      if (member.status !== 'INVITED') {
        throw appErrors.badRequest('MEMBER_NOT_INVITED', 'Ce membre a déjà activé son accès');
      }
      await tx.membership.delete({ where: { id: memberId } });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.invitation_cancelled',
          entityType: 'Membership',
          entityId: memberId,
          before: { role: member.role, firstName: member.firstName, lastName: member.lastName },
          client,
        },
        tx,
      );
    });
  }

  async update(
    user: AuthenticatedUser,
    memberId: string,
    input: StaffUpdateInput,
    client: ClientInfo,
  ): Promise<StaffMember> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const member = await this.lockMember(tx, traiteurId, memberId);
      if (input.role !== member.role) {
        if (member.id === user.membershipId) {
          throw appErrors.badRequest('CANNOT_TARGET_SELF', 'Vous ne pouvez pas changer votre rôle');
        }
        // Nommer ou retirer un administrateur : réservé aux administrateurs
        this.assertCanGrant(user, input.role);
        this.assertCanGrant(user, member.role);
        if (member.role === 'ADMIN_TRAITEUR')
          await this.assertNotLastAdmin(tx, traiteurId, member.id);
      }
      await tx.membership.update({
        where: { id: memberId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          locale: input.locale,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.updated',
          entityType: 'Membership',
          entityId: memberId,
          before: {
            role: member.role,
            firstName: member.firstName,
            lastName: member.lastName,
            locale: member.locale,
          },
          after: { ...input },
          client,
        },
        tx,
      );
    });
    return this.get(user, memberId);
  }

  /** Suspension : accès refusé à la requête suivante, sessions et invitation révoquées. */
  async suspend(
    user: AuthenticatedUser,
    memberId: string,
    input: StaffSuspendInput,
    client: ClientInfo,
  ): Promise<StaffMember> {
    const traiteurId = requireTraiteurId(user);
    await this.prisma.$transaction(async (tx) => {
      const member = await this.lockMember(tx, traiteurId, memberId);
      if (member.id === user.membershipId) {
        throw appErrors.badRequest('CANNOT_TARGET_SELF', 'Vous ne pouvez pas vous suspendre');
      }
      if (member.status === 'SUSPENDED') return;
      this.assertCanGrant(user, member.role);
      if (member.role === 'ADMIN_TRAITEUR')
        await this.assertNotLastAdmin(tx, traiteurId, member.id);
      const now = new Date();
      await tx.membership.update({
        where: { id: memberId },
        data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: input.reason },
      });
      await tx.refreshToken.updateMany({
        where: { membershipId: memberId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.revokeInvitations(tx, memberId, now);
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.suspended',
          entityType: 'Membership',
          entityId: memberId,
          before: { status: member.status },
          after: { reason: input.reason },
          client,
        },
        tx,
      );
    });
    return this.get(user, memberId);
  }

  /**
   * Réactivation. Un membre qui n'a jamais activé son accès (aucun mot de passe) redevient
   * « invité » avec un nouveau lien d'activation.
   */
  async reactivate(
    user: AuthenticatedUser,
    memberId: string,
    client: ClientInfo,
  ): Promise<{ member: StaffMember; link: InvitationLink | null }> {
    const traiteurId = requireTraiteurId(user);
    const pending = await this.prisma.$transaction(async (tx) => {
      const member = await this.lockMember(tx, traiteurId, memberId);
      if (member.status !== 'SUSPENDED') return null;
      this.assertCanGrant(user, member.role);
      const account = await tx.user.findUniqueOrThrow({
        where: { id: member.userId },
        select: { passwordHash: true, lastLoginAt: true },
      });
      const neverActivated = account.passwordHash === null && account.lastLoginAt === null;
      await tx.membership.update({
        where: { id: memberId },
        data: {
          status: neverActivated ? 'INVITED' : 'ACTIVE',
          suspendedAt: null,
          suspensionReason: null,
        },
      });
      const invitation = neverActivated
        ? await this.createInvitation(tx, traiteurId, memberId)
        : null;
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'staff.reactivated',
          entityType: 'Membership',
          entityId: memberId,
          after: { invited: neverActivated },
          client,
        },
        tx,
      );
      return invitation;
    });
    const link = pending
      ? await this.deliver(traiteurId, memberId, pending.token, pending.expiresAt)
      : null;
    return { member: await this.get(user, memberId), link };
  }

  async get(user: AuthenticatedUser, memberId: string): Promise<StaffMember> {
    const traiteurId = requireTraiteurId(user);
    const row = await this.prisma.membership.findFirst({
      where: { id: memberId, traiteurId, role: { in: [...STAFF_ROLES] } },
      include: memberInclude,
    });
    if (!row) throw appErrors.notFound('NOT_FOUND', 'Membre introuvable');
    return this.toMember(row, user);
  }

  // ─────────────────────────── Interne ───────────────────────────

  private toMember(row: MemberRow, user: AuthenticatedUser): StaffMember {
    const invitation = row.status === 'INVITED' ? (row.invitations[0] ?? null) : null;
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.user.phone,
      email: row.email,
      role: row.role as StaffMemberRole,
      status: row.status,
      locale: row.locale === 'ar' ? 'ar' : 'fr',
      invitation: invitation
        ? {
            expiresAt: invitation.expiresAt.toISOString(),
            smsSent: invitation.smsSent,
            expired: invitation.expiresAt.getTime() <= Date.now(),
          }
        : null,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      suspensionReason: row.suspensionReason,
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
      isSelf: row.id === user.membershipId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async createInvitation(
    tx: Db,
    traiteurId: string,
    membershipId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = newLinkToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await tx.staffInvitation.create({
      data: { traiteurId, membershipId, tokenHash: hash, expiresAt },
    });
    return { token, expiresAt };
  }

  private async revokeInvitations(tx: Db, membershipId: string, now = new Date()): Promise<void> {
    await tx.staffInvitation.updateMany({
      where: { membershipId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /**
   * Envoi du lien : par SMS si le numéro est dans un pays autorisé ; toujours retourné à
   * l'administrateur (copie, WhatsApp) pour les autres cas.
   */
  private async deliver(
    traiteurId: string,
    membershipId: string,
    token: string,
    expiresAt: Date,
  ): Promise<InvitationLink> {
    const url = `${this.webUrl}/invitation/${token}`;
    const member = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: {
        role: true,
        locale: true,
        user: { select: { phone: true } },
        traiteur: { select: { name: true } },
      },
    });
    const phone = member.user.phone;
    let smsSent = false;
    if (this.smsCountries.some((code) => phone.startsWith(`+${code}`))) {
      const role = ROLE_LABELS[member.role as StaffMemberRole];
      const message =
        member.locale === 'ar'
          ? `${member.traiteur.name} يدعوك للانضمام إلى فريقه بصفة ${role.ar}: ${url} (صالح لمدة 7 أيام)`
          : `${member.traiteur.name} vous invite à rejoindre son équipe (${role.fr}) : ${url} (valable 7 jours)`;
      try {
        await this.sms.send(phone, message);
        smsSent = true;
        await this.prisma.staffInvitation.updateMany({
          where: { traiteurId, membershipId, usedAt: null, revokedAt: null },
          data: { smsSent: true },
        });
      } catch (error) {
        this.logger.warn(`SMS d'invitation non envoyé : ${String(error)}`);
      }
    }
    return { url, expiresAt: expiresAt.toISOString(), smsSent };
  }

  /** Nommer, retirer ou suspendre un administrateur : réservé aux administrateurs. */
  private assertCanGrant(user: AuthenticatedUser, role: string): void {
    if (role === 'ADMIN_TRAITEUR' && user.role !== 'ADMIN_TRAITEUR' && !user.isSuperAdmin) {
      throw appErrors.forbidden('ADMIN_REQUIRED', 'Réservé aux administrateurs');
    }
  }

  private async assertNotLastAdmin(tx: Db, traiteurId: string, memberId: string): Promise<void> {
    // Sérialise les retraits d'administrateurs d'un même traiteur : deux suspensions croisées
    // simultanées ne peuvent pas laisser le traiteur sans administrateur actif.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-admins:${traiteurId}`}))`;
    const others = await tx.membership.count({
      where: { traiteurId, role: 'ADMIN_TRAITEUR', status: 'ACTIVE', id: { not: memberId } },
    });
    if (others === 0) {
      throw appErrors.badRequest('LAST_ADMIN', 'Il doit rester au moins un administrateur actif');
    }
  }

  /** Verrouille le membre (personnel de ce traiteur) jusqu'à la fin de la transaction. */
  private async lockMember(tx: Db, traiteurId: string, memberId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Membership"
      WHERE "id" = ${memberId}::uuid AND "traiteurId" = ${traiteurId}::uuid
        AND "role"::text IN ('ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR')
      FOR UPDATE`;
    if (locked.length === 0) throw appErrors.notFound('NOT_FOUND', 'Membre introuvable');
    return tx.membership.findUniqueOrThrow({ where: { id: memberId } });
  }
}
