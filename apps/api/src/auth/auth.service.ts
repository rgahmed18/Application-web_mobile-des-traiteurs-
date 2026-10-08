import { Injectable } from '@nestjs/common';
import {
  type AuthContext,
  type AuthSession,
  type AuthUser,
  type LoginInput,
  type Me,
  normalizePhone,
  type OtpRequestInput,
  type OtpRequestResponse,
  type OtpVerifyInput,
  type PasswordResetInput,
  type RegisterInput,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth-user';
import { OtpService } from './otp/otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const UNAVAILABLE_TRAITEUR_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

interface ContextOptions {
  /** Crée un Membership CLIENT si l'utilisateur n'en a pas encore chez ce traiteur. */
  autoJoinAsClient: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Inscription avec mot de passe ; le téléphone est prouvé par un code SMS (SIGNUP). */
  async register(input: RegisterInput, client: ClientInfo): Promise<AuthSession> {
    const traiteur = await this.findAvailableTraiteur(input.traiteurSlug);
    await this.otp.verifyCode(input.phone, 'SIGNUP', input.code);

    if (await this.prisma.user.findUnique({ where: { phone: input.phone } })) {
      throw appErrors.conflict(
        'ACCOUNT_EXISTS',
        'Un compte existe déjà pour ce numéro, connectez-vous',
      );
    }
    if (input.email && (await this.prisma.user.findUnique({ where: { email: input.email } }))) {
      throw appErrors.conflict('EMAIL_TAKEN', 'Cette adresse email est déjà utilisée');
    }

    const user = await this.prisma.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        passwordHash: await this.passwords.hash(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale ?? 'fr',
        lastLoginAt: new Date(),
        memberships: { create: { traiteurId: traiteur.id, role: 'CLIENT' } },
      },
    });
    const context = await this.resolveContext(user, traiteur.slug, { autoJoinAsClient: false });
    return this.createSession(user, context, client);
  }

  /** Connexion par téléphone ou email + mot de passe. */
  async login(input: LoginInput, client: ClientInfo): Promise<AuthSession> {
    const user = await this.findByIdentifier(input.identifier);
    const valid =
      user?.passwordHash !== null && user?.passwordHash !== undefined
        ? await this.passwords.verify(user.passwordHash, input.password)
        : await this.passwords.verifyAgainstDummy(input.password);
    if (!user || !valid) {
      throw appErrors.unauthorized('INVALID_CREDENTIALS', 'Identifiants incorrects');
    }
    this.assertUserActive(user);

    const context = await this.resolveContext(user, input.traiteurSlug ?? null, {
      autoJoinAsClient: true,
    });
    await this.touchLastLogin(user.id);
    return this.createSession(user, context, client);
  }

  /** Demande d'un code SMS. Réponse identique que le compte existe ou non. */
  async requestOtp(input: OtpRequestInput, client: ClientInfo): Promise<OtpRequestResponse> {
    // Réinitialisation : on n'envoie de SMS qu'aux comptes existants, sans le révéler.
    const deliver =
      input.purpose !== 'PASSWORD_RESET' ||
      (await this.prisma.user.findUnique({ where: { phone: input.phone } })) !== null;
    return this.otp.requestCode(input.phone, input.purpose, {
      deliver,
      ipAddress: client.ipAddress,
    });
  }

  /** Connexion par code SMS ; crée un compte sans mot de passe si le numéro est inconnu. */
  async verifyOtp(input: OtpVerifyInput, client: ClientInfo): Promise<AuthSession> {
    const traiteur = await this.findAvailableTraiteur(input.traiteurSlug);
    const otpId = await this.otp.checkCode(input.phone, 'LOGIN', input.code);

    let user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (user) {
      await this.otp.consumeCode(otpId);
    } else {
      if (!input.firstName || !input.lastName) {
        // Le code n'est pas consommé : l'app peut le renvoyer avec le prénom et le nom.
        throw appErrors.badRequest('PROFILE_REQUIRED', 'Prénom et nom requis pour créer le compte');
      }
      await this.otp.consumeCode(otpId);
      user = await this.prisma.user.create({
        data: {
          phone: input.phone,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale ?? 'fr',
        },
      });
    }
    this.assertUserActive(user);

    const context = await this.resolveContext(user, traiteur.slug, { autoJoinAsClient: true });
    await this.touchLastLogin(user.id);
    return this.createSession(user, context, client);
  }

  /** Nouveau mot de passe après vérification par SMS ; toutes les sessions sont révoquées. */
  async resetPassword(input: PasswordResetInput): Promise<void> {
    await this.otp.verifyCode(input.phone, 'PASSWORD_RESET', input.code);
    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (!user) throw appErrors.badRequest('INVALID_OTP', 'Code invalide ou expiré');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    await this.tokens.revokeAllForUser(user.id);
  }

  /** Rotation du refresh token ; le contexte (rôle, statut) est relu en base. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthSession> {
    const consumed = await this.tokens.consumeRefreshToken(refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: consumed.userId } });
    if (!user) throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    this.assertUserActive(user);

    const context = await this.reloadContext(user, consumed.traiteurId, consumed.membershipId);
    return this.createSession(user, context, client, {
      familyId: consumed.familyId,
      previousTokenId: consumed.tokenId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }

  async me(current: AuthenticatedUser): Promise<Me> {
    const user = await this.prisma.user.findUnique({ where: { id: current.userId } });
    if (!user) throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    const permissions = await this.permissions.getEffectivePermissions(
      current.traiteurId,
      current.role,
    );
    return {
      user: this.toAuthUser(user),
      context: {
        traiteurId: current.traiteurId,
        membershipId: current.membershipId,
        role: current.role,
      },
      permissions: [...permissions].sort(),
    };
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async createSession(
    user: User,
    context: AuthContext,
    client: ClientInfo,
    rotation?: { familyId: string; previousTokenId: string },
  ): Promise<AuthSession> {
    const issued = await this.tokens.issueTokens(
      user.id,
      user.isSuperAdmin,
      context,
      client,
      rotation,
    );
    return {
      tokenType: 'Bearer',
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: this.toAuthUser(user),
      context,
    };
  }

  /** Détermine le traiteur actif et le rôle de l'utilisateur pour la session. */
  private async resolveContext(
    user: User,
    traiteurSlug: string | null,
    { autoJoinAsClient }: ContextOptions,
  ): Promise<AuthContext> {
    if (!traiteurSlug) {
      if (user.isSuperAdmin) return { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' };
      throw appErrors.badRequest('TRAITEUR_REQUIRED', 'Le traiteur est requis pour se connecter');
    }

    const traiteur = await this.findAvailableTraiteur(traiteurSlug);
    if (user.isSuperAdmin) {
      return { traiteurId: traiteur.id, membershipId: null, role: 'SUPER_ADMIN' };
    }

    let membership = await this.prisma.membership.findUnique({
      where: { userId_traiteurId: { userId: user.id, traiteurId: traiteur.id } },
    });
    if (!membership) {
      if (!autoJoinAsClient) {
        throw appErrors.forbidden('MEMBERSHIP_INACTIVE', "Vous n'avez pas accès à ce traiteur");
      }
      // Un client existant peut commander chez un nouveau traiteur ; les rôles du personnel
      // ne sont jamais attribués automatiquement (invitation par le traiteur).
      membership = await this.prisma.membership.create({
        data: { userId: user.id, traiteurId: traiteur.id, role: 'CLIENT' },
      });
    } else if (membership.status === 'INVITED') {
      membership = await this.prisma.membership.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE' },
      });
    } else if (membership.status !== 'ACTIVE') {
      throw appErrors.forbidden('MEMBERSHIP_INACTIVE', 'Votre accès à ce traiteur est suspendu');
    }

    return { traiteurId: traiteur.id, membershipId: membership.id, role: membership.role };
  }

  /** Revalide le contexte stocké dans la session lors d'un rafraîchissement. */
  private async reloadContext(
    user: User,
    traiteurId: string | null,
    membershipId: string | null,
  ): Promise<AuthContext> {
    if (user.isSuperAdmin) {
      if (!traiteurId) return { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' };
      await this.assertTraiteurAvailable(traiteurId);
      return { traiteurId, membershipId: null, role: 'SUPER_ADMIN' };
    }
    if (!traiteurId || !membershipId) {
      throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    }

    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, userId: user.id, traiteurId },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw appErrors.forbidden('MEMBERSHIP_INACTIVE', 'Votre accès à ce traiteur est suspendu');
    }
    await this.assertTraiteurAvailable(traiteurId);
    return { traiteurId, membershipId, role: membership.role };
  }

  private async findAvailableTraiteur(slug: string): Promise<{ id: string; slug: string }> {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    if (!traiteur) throw appErrors.notFound('TRAITEUR_NOT_FOUND', 'Traiteur introuvable');
    if (UNAVAILABLE_TRAITEUR_STATUSES.has(traiteur.status)) {
      throw appErrors.forbidden(
        'TRAITEUR_UNAVAILABLE',
        'Ce traiteur est actuellement indisponible',
      );
    }
    return traiteur;
  }

  private async assertTraiteurAvailable(traiteurId: string): Promise<void> {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { id: traiteurId },
      select: { status: true },
    });
    if (!traiteur || UNAVAILABLE_TRAITEUR_STATUSES.has(traiteur.status)) {
      throw appErrors.forbidden(
        'TRAITEUR_UNAVAILABLE',
        'Ce traiteur est actuellement indisponible',
      );
    }
  }

  private findByIdentifier(identifier: string): Promise<User | null> {
    if (identifier.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: identifier.trim().toLowerCase() } });
    }
    const phone = normalizePhone(identifier);
    return phone ? this.prisma.user.findUnique({ where: { phone } }) : Promise.resolve(null);
  }

  private assertUserActive(user: User): void {
    if (user.status !== 'ACTIVE') throw appErrors.forbidden('ACCOUNT_DISABLED', 'Compte désactivé');
  }

  private async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      isSuperAdmin: user.isSuperAdmin,
      hasPassword: user.passwordHash !== null,
    };
  }
}
