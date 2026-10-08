import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { roleSchema, type AuthContext } from '@traiteur/shared';
import { z } from 'zod';

import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Env } from '../config/env.schema';
import type { RefreshToken } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from './auth-user';

const accessTokenPayloadSchema = z.object({
  sub: z.uuid(),
  tid: z.uuid().nullable(),
  mid: z.uuid().nullable(),
  role: roleSchema,
  sa: z.boolean(),
  typ: z.literal('access'),
});

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Résultat de la consommation d'un refresh token (rotation). */
export interface ConsumedRefreshToken {
  userId: string;
  traiteurId: string | null;
  membershipId: string | null;
  familyId: string;
  tokenId: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 3600 * 1000;
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const decoded: unknown = await this.jwt.verifyAsync(token);
      return accessTokenPayloadSchema.parse(decoded);
    } catch {
      throw appErrors.unauthorized('INVALID_TOKEN', 'Jeton invalide ou expiré');
    }
  }

  /**
   * Émet un access token et un refresh token. `familyId` est conservé lors d'une rotation ;
   * `previousTokenId` est relié au nouveau jeton pour tracer la chaîne.
   */
  async issueTokens(
    userId: string,
    isSuperAdmin: boolean,
    context: AuthContext,
    client: ClientInfo,
    rotation?: { familyId: string; previousTokenId: string },
  ): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = {
      sub: userId,
      tid: context.traiteurId,
      mid: context.membershipId,
      role: context.role,
      sa: isSuperAdmin,
      typ: 'access',
    };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(32).toString('base64url');
    const created = await this.prisma.refreshToken.create({
      data: {
        userId,
        traiteurId: context.traiteurId,
        membershipId: context.membershipId,
        familyId: rotation?.familyId ?? randomUUID(),
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
      },
    });
    if (rotation) {
      await this.prisma.refreshToken.update({
        where: { id: rotation.previousTokenId },
        data: { replacedById: created.id },
      });
    }

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }

  /**
   * Consomme un refresh token (usage unique). Si un jeton déjà utilisé est présenté,
   * il a probablement été volé : toute la famille de sessions est révoquée.
   */
  async consumeRefreshToken(refreshToken: string): Promise<ConsumedRefreshToken> {
    const stored = await this.findByToken(refreshToken);
    if (!stored) throw appErrors.unauthorized('INVALID_TOKEN', 'Session invalide');

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      this.logger.warn(`Réutilisation d'un refresh token détectée (famille ${stored.familyId})`);
      throw appErrors.unauthorized('TOKEN_REUSED', 'Session révoquée, reconnectez-vous');
    }
    if (stored.expiresAt <= new Date()) {
      throw appErrors.unauthorized('INVALID_TOKEN', 'Session expirée');
    }

    // Marquage atomique : si deux requêtes utilisent le même jeton en même temps, une seule passe.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      await this.revokeFamily(stored.familyId);
      throw appErrors.unauthorized('TOKEN_REUSED', 'Session révoquée, reconnectez-vous');
    }

    return {
      userId: stored.userId,
      traiteurId: stored.traiteurId,
      membershipId: stored.membershipId,
      familyId: stored.familyId,
      tokenId: stored.id,
    };
  }

  /** Déconnexion : révoque la session (toute la chaîne de rotation) du jeton présenté. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const stored = await this.findByToken(refreshToken);
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Révoque toutes les sessions d'un utilisateur (changement de mot de passe...). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Les refresh tokens ont 256 bits d'entropie : un SHA-256 suffit (pas besoin d'Argon2). */
  hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private findByToken(refreshToken: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(refreshToken) },
    });
  }
}
