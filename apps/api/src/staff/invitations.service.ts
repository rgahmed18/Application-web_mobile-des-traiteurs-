import { Injectable } from '@nestjs/common';
import {
  type InvitationAcceptInput,
  type InvitationAcceptResult,
  maskPhone,
  passwordSchema,
  type PublicInvitation,
  type StaffMemberRole,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { hashLinkToken, isLinkTokenShape } from '../common/link-token';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Activation d'un accès du personnel par son lien (page publique, sans connexion).
 * - Compte sans mot de passe : l'invité choisit le sien.
 * - Compte existant (client ailleurs, autre traiteur…) : il confirme avec son mot de passe ;
 *   le lien ne remplace jamais un mot de passe existant.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async view(token: string): Promise<PublicInvitation> {
    const invitation = await this.find(token);
    return {
      traiteurName: invitation.membership.traiteur.name,
      firstName: invitation.membership.firstName,
      role: invitation.membership.role as StaffMemberRole,
      phone: maskPhone(invitation.membership.user.phone),
      hasPassword: invitation.membership.user.passwordHash !== null,
      expiresAt: invitation.expiresAt.toISOString(),
      locale: invitation.membership.locale === 'ar' ? 'ar' : 'fr',
    };
  }

  async accept(
    token: string,
    input: InvitationAcceptInput,
    client: ClientInfo,
  ): Promise<InvitationAcceptResult> {
    const invitation = await this.find(token);
    const account = invitation.membership.user;
    let passwordHash: string | null = null;
    if (account.passwordHash) {
      if (!(await this.passwords.verify(account.passwordHash, input.password))) {
        throw appErrors.unauthorized('INVALID_CREDENTIALS', 'Mot de passe incorrect');
      }
    } else {
      const parsed = passwordSchema.safeParse(input.password);
      if (!parsed.success) {
        throw appErrors.badRequest(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Mot de passe invalide',
        );
      }
      passwordHash = await this.passwords.hash(parsed.data);
    }

    await this.prisma.$transaction(async (tx) => {
      // Usage unique : seule la première activation concurrente aboutit
      const { count } = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw appErrors.notFound('NOT_FOUND', 'Invitation introuvable');
      const activated = await tx.membership.updateMany({
        where: { id: invitation.membershipId, status: 'INVITED' },
        data: { status: 'ACTIVE' },
      });
      if (activated.count === 0) throw appErrors.notFound('NOT_FOUND', 'Invitation introuvable');
      if (passwordHash) {
        await tx.user.updateMany({
          where: { id: account.id, passwordHash: null },
          data: { passwordHash },
        });
      }
      await this.audit.record(
        {
          traiteurId: invitation.traiteurId,
          actor: null,
          action: 'staff.invitation_accepted',
          entityType: 'Membership',
          entityId: invitation.membershipId,
          after: { passwordCreated: passwordHash !== null },
          client,
        },
        tx,
      );
    });
    return { phone: account.phone, traiteurSlug: invitation.membership.traiteur.slug };
  }

  /** Invitation en cours : jeton connu, ni utilisé ni révoqué, membre encore « invité ». */
  private async find(token: string) {
    if (!isLinkTokenShape(token)) throw appErrors.notFound('NOT_FOUND', 'Invitation introuvable');
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashLinkToken(token) },
      include: {
        membership: {
          select: {
            firstName: true,
            role: true,
            status: true,
            locale: true,
            traiteur: { select: { name: true, slug: true, status: true } },
            user: { select: { id: true, phone: true, passwordHash: true, status: true } },
          },
        },
      },
    });
    if (
      !invitation ||
      invitation.usedAt ||
      invitation.revokedAt ||
      invitation.membership.status !== 'INVITED' ||
      invitation.membership.user.status !== 'ACTIVE'
    ) {
      throw appErrors.notFound('NOT_FOUND', 'Invitation introuvable');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw appErrors.badRequest('INVITATION_EXPIRED', 'Ce lien a expiré');
    }
    return invitation;
  }
}
