import { Injectable } from '@nestjs/common';
import type { Account, AccountUpdateInput, PasswordChangeInput } from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { PrismaService } from '../prisma/prisma.service';

const select = {
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  locale: true,
  passwordHash: true,
} as const;

/**
 * Mon compte : nom, langue et mot de passe de l'utilisateur connecté (quel que soit son rôle).
 * Le nom est aussi mis à jour sur sa fiche dans l'équipe du traiteur actif.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async get(user: AuthenticatedUser): Promise<Account> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select });
    return this.toAccount(row);
  }

  async update(
    user: AuthenticatedUser,
    input: AccountUpdateInput,
    client: ClientInfo,
  ): Promise<Account> {
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: user.userId }, select });
      const after = await tx.user.update({ where: { id: user.userId }, data: input, select });
      if (user.membershipId) {
        await tx.membership.updateMany({
          where: { id: user.membershipId, userId: user.userId },
          data: { firstName: input.firstName, lastName: input.lastName },
        });
      }
      await this.audit.record(
        {
          traiteurId: user.traiteurId,
          actor: user,
          action: 'account.updated',
          entityType: 'User',
          entityId: user.userId,
          before: { firstName: before.firstName, lastName: before.lastName, locale: before.locale },
          after: { ...input },
          client,
        },
        tx,
      );
      return after;
    });
    return this.toAccount(row);
  }

  /** Nouveau mot de passe : toutes les sessions sont fermées (reconnexion nécessaire). */
  async changePassword(
    user: AuthenticatedUser,
    input: PasswordChangeInput,
    client: ClientInfo,
  ): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { passwordHash: true },
    });
    if (row.passwordHash) {
      const valid =
        input.currentPassword !== null &&
        (await this.passwords.verify(row.passwordHash, input.currentPassword));
      if (!valid) {
        throw appErrors.badRequest('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect');
      }
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.userId }, data: { passwordHash } });
      await this.audit.record(
        {
          traiteurId: user.traiteurId,
          actor: user,
          action: 'account.password_changed',
          entityType: 'User',
          entityId: user.userId,
          client,
        },
        tx,
      );
    });
    await this.tokens.revokeAllForUser(user.userId);
  }

  private toAccount(row: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    locale: string;
    passwordHash: string | null;
  }): Account {
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      locale: row.locale === 'ar' ? 'ar' : 'fr',
      hasPassword: row.passwordHash !== null,
    };
  }
}
