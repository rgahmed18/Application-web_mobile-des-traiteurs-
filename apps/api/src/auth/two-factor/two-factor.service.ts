import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthContext, TwoFactorSetupInfo, TwoFactorStatus } from '@traiteur/shared';
import { toString as qrToString } from 'qrcode';

import { appErrors } from '../../common/errors';
import { hashLinkToken, isLinkTokenShape, newLinkToken } from '../../common/link-token';
import type { ClientInfo } from '../../common/http/client-info';
import type { Env } from '../../config/env.schema';
import type { TwoFactorChallenge, User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCodeShape } from './recovery-codes';
import { openSecret, sealSecret } from './secret-box';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/** Connexion en attente de la deuxième étape : 10 minutes, 5 essais. */
export const CHALLENGE_TTL_SECONDS = 600;
export const CHALLENGE_MAX_ATTEMPTS = 5;
const ISSUER = 'Gestion Traiteurs';

export type ChallengeKind = 'VERIFY' | 'SETUP';

/** Résultat d'un code saisi : application (pas de temps accepté) ou code de secours. */
export type CodeCheck = { via: 'totp'; step: number } | { via: 'recovery' } | null;

/**
 * Double authentification : secrets chiffrés, codes TOTP sans rejeu, codes de secours à usage
 * unique, connexions en attente de la deuxième étape. La politique (obligatoire pour le
 * SUPER_ADMIN) et le verrouillage progressif sont appliqués par AuthService.
 */
@Injectable()
export class TwoFactorService {
  private readonly key: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.key = config.get('TWO_FACTOR_ENCRYPTION_KEY', { infer: true });
  }

  /** Imposée au SUPER_ADMIN (accès à toute la plateforme). */
  isRequired(user: Pick<User, 'isSuperAdmin'>): boolean {
    return user.isSuperAdmin;
  }

  isEnabled(user: Pick<User, 'twoFactorEnabledAt'>): boolean {
    return user.twoFactorEnabledAt !== null;
  }

  async status(user: User): Promise<TwoFactorStatus> {
    const remaining = await this.prisma.twoFactorRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    return {
      enabled: this.isEnabled(user),
      enabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
      required: this.isRequired(user),
      recoveryCodesRemaining: this.isEnabled(user) ? remaining : 0,
    };
  }

  // ─────────────────────── Connexions en deuxième étape ───────────────────────

  async createChallenge(
    user: User,
    context: AuthContext,
    kind: ChallengeKind,
    client: ClientInfo,
  ): Promise<string> {
    const { token, hash } = newLinkToken();
    await this.prisma.twoFactorChallenge.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        kind,
        traiteurId: context.traiteurId,
        membershipId: context.membershipId,
        role: context.role,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
        ipAddress: client.ipAddress,
      },
    });
    return token;
  }

  /** Jeton valide (non utilisé, non expiré, essais restants) du type attendu ; 401 sinon. */
  async loadChallenge(token: string, kind: ChallengeKind): Promise<TwoFactorChallenge> {
    const invalid = () =>
      appErrors.unauthorized(
        'TWO_FACTOR_CHALLENGE_INVALID',
        'Vérification expirée : reconnectez-vous',
      );
    if (!isLinkTokenShape(token)) throw invalid();
    const challenge = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: hashLinkToken(token) },
    });
    if (
      !challenge ||
      challenge.kind !== kind ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= CHALLENGE_MAX_ATTEMPTS
    ) {
      throw invalid();
    }
    return challenge;
  }

  /** Essai manqué ; au cinquième, le jeton ne vaut plus rien. */
  async recordChallengeFailure(challengeId: string): Promise<void> {
    await this.prisma.twoFactorChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
  }

  /** Usage unique : refus si un autre appel l'a déjà consommé. */
  async consumeChallenge(challengeId: string): Promise<void> {
    const { count } = await this.prisma.twoFactorChallenge.updateMany({
      where: { id: challengeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) {
      throw appErrors.unauthorized(
        'TWO_FACTOR_CHALLENGE_INVALID',
        'Vérification expirée : reconnectez-vous',
      );
    }
  }

  // ─────────────────────────── Activation ───────────────────────────

  /** Nouveau secret proposé (chiffré) et ce qu'il faut montrer : QR code et clé manuelle. */
  async proposeSecret(user: User): Promise<{ sealed: string; info: TwoFactorSetupInfo }> {
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, user.email ?? user.phone, ISSUER);
    return {
      sealed: sealSecret(secret, this.key),
      info: {
        secret: secret.replace(/(.{4})/g, '$1 ').trim(),
        otpauthUri: uri,
        qrSvg: await qrToString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
      },
    };
  }

  /** Premier code de l'application pour un secret proposé : pas de temps accepté, ou null. */
  checkProposedCode(sealed: string, code: string): number | null {
    return verifyTotp(openSecret(sealed, this.key), code, new Date(), null);
  }

  /** Active la double authentification et retourne les codes de secours (affichés une fois). */
  async enable(userId: string, sealed: string, step: number): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: sealed,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: new Date(),
          twoFactorLastStep: step,
        },
      }),
    ]);
    return codes;
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      }),
    ]);
    return codes;
  }

  /** Désactivation (ou réinitialisation de secours) : secret et codes supprimés. */
  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: null,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: null,
          twoFactorLastStep: null,
        },
      }),
    ]);
  }

  // ─────────────────────────── Vérification ───────────────────────────

  /**
   * Code de l'application (jamais deux fois le même) ou code de secours (consommé). Les
   * écritures sont conditionnelles : deux envois simultanés du même code n'en valident qu'un.
   */
  async checkCode(user: User, code: string): Promise<CodeCheck> {
    if (!user.twoFactorSecret) return null;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(
        openSecret(user.twoFactorSecret, this.key),
        code,
        new Date(),
        user.twoFactorLastStep,
      );
      if (step === null) return null;
      const { count } = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }],
        },
        data: { twoFactorLastStep: step },
      });
      return count === 1 ? { via: 'totp', step } : null;
    }
    if (!isRecoveryCodeShape(code)) return null;
    const { count } = await this.prisma.twoFactorRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? { via: 'recovery' } : null;
  }
}
