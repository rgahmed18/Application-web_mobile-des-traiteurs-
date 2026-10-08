import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { getErrorCode } from '../common/errors';
import type { Env } from '../config/env.schema';
import type { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

interface StoredToken {
  id: string;
  userId: string;
  traiteurId: string | null;
  membershipId: string | null;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TRAITEUR_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';

function setup() {
  const tokens: StoredToken[] = [];
  const prisma = {
    refreshToken: {
      create: ({ data }: { data: Omit<StoredToken, 'id' | 'revokedAt'> }) => {
        const row = { ...data, id: `rt-${tokens.length + 1}`, revokedAt: null };
        tokens.push(row);
        return Promise.resolve(row);
      },
      update: () => Promise.resolve(),
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: { id?: string; familyId?: string; userId?: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const targets = tokens.filter(
          (t) =>
            t.revokedAt === null &&
            (where.id === undefined || t.id === where.id) &&
            (where.familyId === undefined || t.familyId === where.familyId) &&
            (where.userId === undefined || t.userId === where.userId),
        );
        for (const t of targets) t.revokedAt = data.revokedAt;
        return Promise.resolve({ count: targets.length });
      },
    },
  };
  const settings: Partial<Env> = { JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30 };
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const jwt = new JwtService({ secret: 's'.repeat(32), signOptions: { expiresIn: 900 } });
  const service = new TokenService(jwt, prisma as unknown as PrismaService, config);
  return { service, tokens };
}

const context = { traiteurId: TRAITEUR_ID, membershipId: MEMBERSHIP_ID, role: 'CLIENT' as const };
const client = { ipAddress: '127.0.0.1', userAgent: 'jest' };

async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return getErrorCode(error);
  }
  return undefined;
}

describe('TokenService', () => {
  it('émet un access token vérifiable contenant le contexte traiteur', async () => {
    const { service } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    await expect(service.verifyAccessToken(issued.accessToken)).resolves.toEqual({
      sub: USER_ID,
      tid: TRAITEUR_ID,
      mid: MEMBERSHIP_ID,
      role: 'CLIENT',
      sa: false,
      typ: 'access',
    });
  });

  it('refuse un access token falsifié', async () => {
    const { service } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    expect(await errorCodeOf(service.verifyAccessToken(`${issued.accessToken}x`))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('ne stocke que le hash du refresh token', async () => {
    const { service, tokens } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    expect(tokens[0]?.tokenHash).not.toBe(issued.refreshToken);
    expect(tokens[0]?.tokenHash).toBe(service.hashRefreshToken(issued.refreshToken));
  });

  it('consomme un refresh token une seule fois et conserve la famille', async () => {
    const { service } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    const consumed = await service.consumeRefreshToken(issued.refreshToken);
    expect(consumed).toMatchObject({ userId: USER_ID, traiteurId: TRAITEUR_ID });

    const rotated = await service.issueTokens(USER_ID, false, context, client, {
      familyId: consumed.familyId,
      previousTokenId: consumed.tokenId,
    });
    await expect(service.consumeRefreshToken(rotated.refreshToken)).resolves.toMatchObject({
      familyId: consumed.familyId,
    });
  });

  it('détecte la réutilisation d’un jeton et révoque toute la famille', async () => {
    const { service, tokens } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    const consumed = await service.consumeRefreshToken(issued.refreshToken);
    const rotated = await service.issueTokens(USER_ID, false, context, client, {
      familyId: consumed.familyId,
      previousTokenId: consumed.tokenId,
    });

    // Un attaquant rejoue l'ancien jeton
    expect(await errorCodeOf(service.consumeRefreshToken(issued.refreshToken))).toBe(
      'TOKEN_REUSED',
    );
    // Le jeton légitime le plus récent est révoqué lui aussi
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(await errorCodeOf(service.consumeRefreshToken(rotated.refreshToken))).toBe(
      'TOKEN_REUSED',
    );
  });

  it('refuse un refresh token expiré ou inconnu', async () => {
    const { service, tokens } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    const row = tokens[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    expect(await errorCodeOf(service.consumeRefreshToken(issued.refreshToken))).toBe(
      'INVALID_TOKEN',
    );
    expect(await errorCodeOf(service.consumeRefreshToken('inconnu-'.repeat(5)))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('la déconnexion révoque la session', async () => {
    const { service } = setup();
    const issued = await service.issueTokens(USER_ID, false, context, client);
    await service.revokeByToken(issued.refreshToken);
    expect(await errorCodeOf(service.consumeRefreshToken(issued.refreshToken))).toBe(
      'TOKEN_REUSED',
    );
  });
});
