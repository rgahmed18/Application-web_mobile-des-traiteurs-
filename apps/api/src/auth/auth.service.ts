import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AuthContext,
  type AuthSession,
  type AuthUser,
  type LoginInput,
  type LoginResult,
  type Me,
  normalizePhone,
  type OtpRequestInput,
  type OtpRequestResponse,
  type OtpVerifyInput,
  type PasswordResetInput,
  PLATFORM_ACCESS_HOURS,
  type PlatformAccess,
  type RecoveryCodes,
  type RegisterInput,
  type TwoFactorChallengeConfirmInput,
  type TwoFactorChallengeConfirmResult,
  type TwoFactorChallengeSetupInput,
  type TwoFactorSetupInfo,
  type TwoFactorStatus,
  type TwoFactorVerifyInput,
} from '@traiteur/shared';

import { PermissionsService } from '../access/permissions.service';
import { AuditService } from '../audit/audit.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Env } from '../config/env.schema';
import type { User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthenticatedUser } from './auth-user';
import { computeLockedUntil, isLocked } from './login-lockout';
import { OtpService } from './otp/otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { CHALLENGE_TTL_SECONDS, TwoFactorService } from './two-factor/two-factor.service';

const UNAVAILABLE_TRAITEUR_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/**
 * Message unique pour tout échec de connexion par mot de passe : il ne révèle ni si le compte
 * existe, ni s'il est verrouillé.
 */
const LOGIN_FAILED_MESSAGE =
  'Identifiants incorrects ou compte temporairement verrouillé. Réessayez dans quelques minutes.';

/** Contexte d'une session, avec l'accès de la plateforme d'un super admin entré chez un traiteur. */
type SessionContext = AuthContext & { platformAccessId?: string | null };

function platformAccessExpiry(from: Date): Date {
  return new Date(from.getTime() + PLATFORM_ACCESS_HOURS * 3600 * 1000);
}

interface ContextOptions {
  /** Crée un Membership CLIENT si l'utilisateur n'en a pas encore chez ce traiteur. */
  autoJoinAsClient: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxLoginFailures: number;
  private readonly lockoutMinutes: readonly number[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxLoginFailures = config.get('LOGIN_MAX_FAILURES', { infer: true });
    this.lockoutMinutes = config.get('LOGIN_LOCKOUT_MINUTES', { infer: true });
  }

  /** Inscription avec mot de passe ; le téléphone est prouvé par un code SMS (SIGNUP). */
  async register(input: RegisterInput, client: ClientInfo): Promise<AuthSession> {
    const traiteur = await this.findAvailableTraiteur(input.traiteurSlug);
    // Vérifie le code sans le consommer : un conflit (compte ou email existant) le laisse valide.
    const otpId = await this.otp.checkCode(input.phone, 'SIGNUP', input.code);

    if (await this.prisma.user.findUnique({ where: { phone: input.phone } })) {
      throw appErrors.conflict(
        'ACCOUNT_EXISTS',
        'Un compte existe déjà pour ce numéro, connectez-vous',
      );
    }
    if (input.email && (await this.prisma.user.findUnique({ where: { email: input.email } }))) {
      throw appErrors.conflict('EMAIL_TAKEN', 'Cette adresse email est déjà utilisée');
    }
    await this.otp.consumeCode(otpId);

    const user = await this.prisma.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        passwordHash: await this.passwords.hash(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale ?? 'fr',
        lastLoginAt: new Date(),
        memberships: {
          create: {
            traiteurId: traiteur.id,
            role: 'CLIENT',
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email ?? null,
            locale: input.locale ?? 'fr',
          },
        },
      },
    });
    const context = await this.resolveContext(user, traiteur.slug, { autoJoinAsClient: false });
    return this.createSession(user, context, client);
  }

  /**
   * Connexion par téléphone ou email + mot de passe.
   * Après LOGIN_MAX_FAILURES échecs consécutifs, le compte est verrouillé de façon progressive.
   * Compte inconnu, mot de passe faux ou compte verrouillé : réponse et durée identiques.
   */
  async login(input: LoginInput, client: ClientInfo): Promise<LoginResult> {
    const now = new Date();
    const user = await this.findByIdentifier(input.identifier);
    const locked = user !== null && isLocked(user.lockedUntil, now);

    // Une vérification Argon2 a toujours lieu (réelle ou factice) pour un temps de réponse constant.
    const valid =
      !locked && user?.passwordHash !== null && user?.passwordHash !== undefined
        ? await this.passwords.verify(user.passwordHash, input.password)
        : await this.passwords.verifyAgainstDummy(input.password);

    if (!user || !valid) {
      if (user && locked) {
        await this.auditAuth('auth.login_blocked', user, client, {
          lockedUntil: user.lockedUntil?.toISOString() ?? null,
        });
      } else if (user) {
        await this.recordFailedLogin(user, client, now);
      }
      throw appErrors.unauthorized('INVALID_CREDENTIALS', LOGIN_FAILED_MESSAGE);
    }
    this.assertUserActive(user);

    const context = await this.resolveContext(user, input.traiteurSlug ?? null, {
      autoJoinAsClient: true,
    });
    return this.completeLogin(user, context, client);
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
  async verifyOtp(input: OtpVerifyInput, client: ClientInfo): Promise<LoginResult> {
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
    return this.completeLogin(user, context, client);
  }

  // ─────────────────────── Double authentification ───────────────────────

  /** Deuxième étape de la connexion : code de l'application ou code de secours. */
  async verifyTwoFactor(input: TwoFactorVerifyInput, client: ClientInfo): Promise<AuthSession> {
    const challenge = await this.twoFactor.loadChallenge(input.challengeToken, 'VERIFY');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    this.assertUserActive(user);
    const now = new Date();
    if (isLocked(user.lockedUntil, now)) {
      await this.auditAuth('auth.login_blocked', user, client, {
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
      });
      throw this.invalidTwoFactorCode();
    }
    const check = await this.twoFactor.checkCode(user, input.code);
    if (!check) {
      await this.twoFactor.recordChallengeFailure(challenge.id);
      await this.recordFailedLogin(user, client, now, 'auth.2fa_failed');
      throw this.invalidTwoFactorCode();
    }
    await this.twoFactor.consumeChallenge(challenge.id);
    if (check.via === 'recovery') {
      const remaining = (await this.twoFactor.status(user)).recoveryCodesRemaining;
      await this.auditAuth('auth.2fa_recovery_code_used', user, client, { remaining });
    }
    const context = await this.reloadContext(user, challenge.traiteurId, challenge.membershipId);
    await this.touchLastLogin(user.id);
    return this.createSession(user, context, client);
  }

  /** Activation imposée à la connexion (SUPER_ADMIN) : clé et QR code à scanner. */
  async setupTwoFactorChallenge(input: TwoFactorChallengeSetupInput): Promise<TwoFactorSetupInfo> {
    const challenge = await this.twoFactor.loadChallenge(input.challengeToken, 'SETUP');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    const { sealed, info } = await this.twoFactor.proposeSecret(user);
    await this.prisma.twoFactorChallenge.update({
      where: { id: challenge.id },
      data: { pendingSecret: sealed },
    });
    return info;
  }

  /** Premier code de l'application : double authentification activée, session ouverte. */
  async confirmTwoFactorChallenge(
    input: TwoFactorChallengeConfirmInput,
    client: ClientInfo,
  ): Promise<TwoFactorChallengeConfirmResult> {
    const challenge = await this.twoFactor.loadChallenge(input.challengeToken, 'SETUP');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    this.assertUserActive(user);
    const step = challenge.pendingSecret
      ? this.twoFactor.checkProposedCode(challenge.pendingSecret, input.code)
      : null;
    if (step === null || !challenge.pendingSecret) {
      await this.twoFactor.recordChallengeFailure(challenge.id);
      throw this.invalidTwoFactorCode();
    }
    await this.twoFactor.consumeChallenge(challenge.id);
    const recoveryCodes = await this.twoFactor.enable(user.id, challenge.pendingSecret, step);
    // Aucune session ouverte sans double authentification ne doit survivre
    await this.tokens.revokeAllForUser(user.id);
    await this.auditAuth('auth.2fa_enabled', user, client, { required: 1 });
    const context = await this.reloadContext(user, challenge.traiteurId, challenge.membershipId);
    await this.touchLastLogin(user.id);
    const enabled = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { session: await this.createSession(enabled, context, client), recoveryCodes };
  }

  async twoFactorStatus(current: AuthenticatedUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(await this.currentUser(current));
  }

  /** Activation depuis « Mon compte » : secret proposé, en attente du premier code. */
  async beginTwoFactorSetup(current: AuthenticatedUser): Promise<TwoFactorSetupInfo> {
    const user = await this.currentUser(current);
    if (this.twoFactor.isEnabled(user)) {
      throw appErrors.conflict(
        'TWO_FACTOR_ALREADY_ENABLED',
        'La double authentification est déjà active',
      );
    }
    const { sealed, info } = await this.twoFactor.proposeSecret(user);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorPendingSecret: sealed },
    });
    return info;
  }

  async confirmTwoFactorSetup(
    current: AuthenticatedUser,
    code: string,
    client: ClientInfo,
  ): Promise<RecoveryCodes> {
    const user = await this.currentUser(current);
    if (this.twoFactor.isEnabled(user)) {
      throw appErrors.conflict(
        'TWO_FACTOR_ALREADY_ENABLED',
        'La double authentification est déjà active',
      );
    }
    const pending = user.twoFactorPendingSecret;
    const step = pending ? this.twoFactor.checkProposedCode(pending, code) : null;
    if (step === null || !pending) throw this.invalidTwoFactorCode();
    const recoveryCodes = await this.twoFactor.enable(user.id, pending, step);
    await this.audit.record({
      traiteurId: null,
      actor: current,
      action: 'auth.2fa_enabled',
      entityType: 'User',
      entityId: user.id,
      after: { required: this.twoFactor.isRequired(user) },
      client,
    });
    return { recoveryCodes };
  }

  /** Désactivation (facultative seulement) : un code valide est exigé. */
  async disableTwoFactor(
    current: AuthenticatedUser,
    code: string,
    client: ClientInfo,
  ): Promise<void> {
    const user = await this.currentUser(current);
    if (this.twoFactor.isRequired(user)) {
      throw appErrors.forbidden(
        'TWO_FACTOR_REQUIRED',
        'La double authentification est obligatoire pour ce compte',
      );
    }
    if (!this.twoFactor.isEnabled(user)) {
      throw appErrors.badRequest(
        'TWO_FACTOR_NOT_ENABLED',
        'La double authentification est inactive',
      );
    }
    if (!(await this.twoFactor.checkCode(user, code))) throw this.invalidTwoFactorCode();
    await this.twoFactor.disable(user.id);
    await this.audit.record({
      traiteurId: null,
      actor: current,
      action: 'auth.2fa_disabled',
      entityType: 'User',
      entityId: user.id,
      client,
    });
  }

  /** Nouveaux codes de secours (les anciens ne valent plus rien) : un code valide est exigé. */
  async regenerateRecoveryCodes(
    current: AuthenticatedUser,
    code: string,
    client: ClientInfo,
  ): Promise<RecoveryCodes> {
    const user = await this.currentUser(current);
    if (!this.twoFactor.isEnabled(user)) {
      throw appErrors.badRequest(
        'TWO_FACTOR_NOT_ENABLED',
        'La double authentification est inactive',
      );
    }
    if (!(await this.twoFactor.checkCode(user, code))) throw this.invalidTwoFactorCode();
    const recoveryCodes = await this.twoFactor.regenerateRecoveryCodes(user.id);
    await this.audit.record({
      traiteurId: null,
      actor: current,
      action: 'auth.2fa_recovery_codes_regenerated',
      entityType: 'User',
      entityId: user.id,
      client,
    });
    return { recoveryCodes };
  }

  /** Nouveau mot de passe après vérification par SMS ; toutes les sessions sont révoquées. */
  async resetPassword(input: PasswordResetInput, client: ClientInfo): Promise<void> {
    await this.otp.verifyCode(input.phone, 'PASSWORD_RESET', input.code);
    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (!user) throw appErrors.badRequest('INVALID_OTP', 'Code invalide ou expiré');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(input.newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllForUser(user.id);
    await this.auditAuth('auth.password_reset', user, client, {});
  }

  /** Rotation du refresh token ; le contexte (rôle, statut) est relu en base. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthSession> {
    const consumed = await this.tokens.consumeRefreshToken(refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: consumed.userId } });
    if (!user) throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    this.assertUserActive(user);
    // Défense en profondeur : la double authentification est imposée au SUPER_ADMIN
    if (this.twoFactor.isRequired(user) && !this.twoFactor.isEnabled(user)) {
      await this.tokens.revokeAllForUser(user.id);
      throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    }

    const context = await this.reloadContext(
      user,
      consumed.traiteurId,
      consumed.membershipId,
      consumed.platformAccessId,
      client,
    );
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
      traiteur: current.traiteurId ? await this.branding(current.traiteurId) : null,
      platformAccess: current.platformAccessId
        ? await this.platformAccess(current.platformAccessId)
        : null,
    };
  }

  // ─────────────────── Accès de la plateforme chez un traiteur ───────────────────

  /**
   * Le super admin entre chez un traiteur pour l'aider : motif obligatoire, accès de
   * PLATFORM_ACCESS_HOURS heures, session limitée à ce traiteur. Un accès encore ouvert ailleurs
   * est clos. Entrée tracée dans le journal du traiteur.
   */
  async enterTraiteur(
    current: AuthenticatedUser,
    traiteurId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<AuthSession> {
    const user = await this.currentUser(current);
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { id: traiteurId },
      select: { id: true },
    });
    if (!traiteur) throw appErrors.notFound('TRAITEUR_NOT_FOUND', 'Traiteur introuvable');

    const now = new Date();
    const access = await this.prisma.$transaction(async (tx) => {
      const open = await tx.platformAccess.findMany({
        where: { userId: user.id, endedAt: null },
        select: { id: true, traiteurId: true, expiresAt: true },
      });
      for (const previous of open) {
        const endReason = previous.expiresAt > now ? 'LEFT' : 'EXPIRED';
        await tx.platformAccess.update({
          where: { id: previous.id },
          data: { endedAt: now, endReason },
        });
        await tx.refreshToken.updateMany({
          where: { platformAccessId: previous.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.audit.record(
          {
            traiteurId: previous.traiteurId,
            actor: current,
            action: 'platform.access_ended',
            entityType: 'PlatformAccess',
            entityId: previous.id,
            after: { endReason },
            client,
          },
          tx,
        );
      }
      const created = await tx.platformAccess.create({
        data: {
          userId: user.id,
          traiteurId,
          reason,
          startedAt: now,
          expiresAt: platformAccessExpiry(now),
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: current,
          action: 'platform.access_started',
          entityType: 'PlatformAccess',
          entityId: created.id,
          after: { reason, expiresAt: created.expiresAt.toISOString() },
          client,
        },
        tx,
      );
      return created;
    });

    return this.createSession(
      user,
      { traiteurId, membershipId: null, role: 'SUPER_ADMIN', platformAccessId: access.id },
      client,
    );
  }

  /** Prolonge l'accès en cours de PLATFORM_ACCESS_HOURS heures à partir de maintenant (nouveau motif). */
  async extendPlatformAccess(
    current: AuthenticatedUser,
    reason: string,
    client: ClientInfo,
  ): Promise<PlatformAccess> {
    const accessId = this.requirePlatformAccess(current);
    const now = new Date();
    const expiresAt = platformAccessExpiry(now);
    const { count } = await this.prisma.platformAccess.updateMany({
      where: { id: accessId, userId: current.userId, endedAt: null, expiresAt: { gt: now } },
      data: { expiresAt, extensions: { increment: 1 } },
    });
    if (count === 0) {
      throw appErrors.unauthorized(
        'PLATFORM_ACCESS_ENDED',
        'Accès au traiteur terminé : retour à la console',
      );
    }
    await this.audit.record({
      traiteurId: current.traiteurId,
      actor: current,
      action: 'platform.access_extended',
      entityType: 'PlatformAccess',
      entityId: accessId,
      after: { reason, expiresAt: expiresAt.toISOString() },
      client,
    });
    const access = await this.platformAccess(accessId);
    if (!access) {
      throw appErrors.unauthorized(
        'PLATFORM_ACCESS_ENDED',
        'Accès au traiteur terminé : retour à la console',
      );
    }
    return access;
  }

  /**
   * Quitte le traiteur : l'accès est clos, les sessions ouvertes chez lui sont révoquées, et une
   * session de la console est renvoyée.
   */
  async leaveTraiteur(current: AuthenticatedUser, client: ClientInfo): Promise<AuthSession> {
    const accessId = this.requirePlatformAccess(current);
    const user = await this.currentUser(current);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.platformAccess.updateMany({
        where: { id: accessId, userId: user.id, endedAt: null },
        data: { endedAt: now, endReason: 'LEFT' },
      });
      await tx.refreshToken.updateMany({
        where: { platformAccessId: accessId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count === 1) {
        await this.audit.record(
          {
            traiteurId: current.traiteurId,
            actor: current,
            action: 'platform.access_ended',
            entityType: 'PlatformAccess',
            entityId: accessId,
            after: { endReason: 'LEFT' },
            client,
          },
          tx,
        );
      }
    });
    return this.createSession(
      user,
      { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' },
      client,
    );
  }

  // ─────────────────────────── Interne ───────────────────────────

  private requirePlatformAccess(current: AuthenticatedUser): string {
    if (!current.isSuperAdmin || !current.traiteurId || !current.platformAccessId) {
      throw appErrors.forbidden(
        'PLATFORM_ACCESS_REQUIRED',
        'Réservé au super admin entré chez un traiteur',
      );
    }
    return current.platformAccessId;
  }

  /**
   * Identité prouvée (mot de passe ou code SMS) : session directe, ou deuxième étape si la double
   * authentification est active (VERIFY) ou imposée mais pas encore configurée (SETUP).
   */
  private async completeLogin(
    user: User,
    context: AuthContext,
    client: ClientInfo,
  ): Promise<LoginResult> {
    const kind = this.twoFactor.isEnabled(user)
      ? 'VERIFY'
      : this.twoFactor.isRequired(user)
        ? 'SETUP'
        : null;
    if (!kind) {
      await this.touchLastLogin(user.id);
      return this.createSession(user, context, client);
    }
    const challengeToken = await this.twoFactor.createChallenge(user, context, kind, client);
    return { twoFactor: kind, challengeToken, expiresIn: CHALLENGE_TTL_SECONDS };
  }

  /** Accès en cours d'un super admin chez un traiteur (bandeau du back-office). */
  private async platformAccess(id: string): Promise<Me['platformAccess']> {
    const access = await this.prisma.platformAccess.findUnique({
      where: { id },
      include: { traiteur: { select: { name: true } } },
    });
    if (!access || access.endedAt) return null;
    return {
      id: access.id,
      traiteurName: access.traiteur.name,
      reason: access.reason,
      startedAt: access.startedAt.toISOString(),
      expiresAt: access.expiresAt.toISOString(),
    };
  }

  /** Nom et logo du traiteur (marque blanche du back-office). */
  private async branding(traiteurId: string): Promise<{ name: string; logoUrl: string | null }> {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { id: traiteurId },
      select: { name: true, logoKey: true },
    });
    if (!traiteur) return { name: '', logoUrl: null };
    let logoUrl: string | null = null;
    if (traiteur.logoKey) {
      try {
        logoUrl = await this.storage.signedDownloadUrl(traiteur.logoKey, 'logo.png', 3600);
      } catch (error) {
        this.logger.warn(`Logo du traiteur ${traiteurId} indisponible : ${String(error)}`);
      }
    }
    return { name: traiteur.name, logoUrl };
  }

  private async currentUser(current: AuthenticatedUser): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: current.userId } });
    if (!user) throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');
    return user;
  }

  private invalidTwoFactorCode() {
    return appErrors.unauthorized('INVALID_TWO_FACTOR_CODE', 'Code incorrect ou déjà utilisé');
  }

  private async createSession(
    user: User,
    context: SessionContext,
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
      context: {
        traiteurId: context.traiteurId,
        membershipId: context.membershipId,
        role: context.role,
      },
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

    // Le SUPER_ADMIN arrive toujours sur la console de la plateforme, jamais chez un traiteur :
    // il n'y entre qu'explicitement (motif demandé, accès limité dans le temps et tracé).
    if (user.isSuperAdmin) return { traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' };
    const traiteur = await this.findAvailableTraiteur(traiteurSlug);

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
        data: {
          userId: user.id,
          traiteurId: traiteur.id,
          role: 'CLIENT',
          // Coordonnées propres à ce traiteur, initialisées depuis le compte
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          locale: user.locale,
        },
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
    platformAccessId: string | null = null,
    client?: ClientInfo,
  ): Promise<SessionContext> {
    if (user.isSuperAdmin) {
      const platform: SessionContext = {
        traiteurId: null,
        membershipId: null,
        role: 'SUPER_ADMIN',
      };
      if (!traiteurId) return platform;
      // Chez un traiteur : seulement pendant un accès en cours ; sinon retour à la console
      const now = new Date();
      const access = platformAccessId
        ? await this.prisma.platformAccess.findFirst({
            where: { id: platformAccessId, userId: user.id, traiteurId },
          })
        : null;
      if (access && !access.endedAt && access.expiresAt > now) {
        return { traiteurId, membershipId: null, role: 'SUPER_ADMIN', platformAccessId: access.id };
      }
      if (access && !access.endedAt) {
        const { count } = await this.prisma.platformAccess.updateMany({
          where: { id: access.id, endedAt: null },
          data: { endedAt: now, endReason: 'EXPIRED' },
        });
        if (count === 1) {
          await this.audit.record({
            traiteurId,
            actor: null,
            action: 'platform.access_ended',
            entityType: 'PlatformAccess',
            entityId: access.id,
            after: { endReason: 'EXPIRED', userId: user.id },
            client,
          });
        }
      }
      return platform;
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

  /** Connexion réussie (mot de passe ou code SMS) : remise à zéro du compteur d'échecs. */
  private async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  }

  /** Incrémente le compteur d'échecs (de façon atomique) et verrouille au-delà du seuil. */
  private async recordFailedLogin(
    user: User,
    client: ClientInfo,
    now: Date,
    action = 'auth.login_failed',
  ): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    await this.auditAuth(action, user, client, { failedLoginCount });

    const lockedUntil = computeLockedUntil(
      failedLoginCount,
      this.maxLoginFailures,
      this.lockoutMinutes,
      now,
    );
    if (lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { lockedUntil } });
      this.logger.warn(
        `Compte ${user.id} verrouillé jusqu'à ${lockedUntil.toISOString()} (${failedLoginCount} échecs)`,
      );
      await this.auditAuth('auth.account_locked', user, client, {
        failedLoginCount,
        lockedUntil: lockedUntil.toISOString(),
      });
    }
  }

  /** Événement de sécurité dans le journal d'audit (niveau plateforme : identité globale). */
  private auditAuth(
    action: string,
    user: User,
    client: ClientInfo,
    after: Record<string, string | number | null>,
  ): Promise<void> {
    return this.audit.record({
      traiteurId: null,
      actor: null,
      action,
      entityType: 'User',
      entityId: user.id,
      after,
      client,
    });
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
      twoFactorEnabled: user.twoFactorEnabledAt !== null,
    };
  }
}
