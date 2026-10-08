import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FeatureKey } from '@traiteur/shared';
import type { Redis } from 'ioredis';

import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 300;

/** Fonctionnalités activées pour un traiteur (FeatureFlag), avec cache Redis. */
@Injectable()
export class FeaturesService {
  private readonly logger = new Logger(FeaturesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isEnabled(traiteurId: string, feature: FeatureKey): Promise<boolean> {
    return (await this.getEnabledFeatures(traiteurId)).has(feature);
  }

  async getEnabledFeatures(traiteurId: string): Promise<Set<string>> {
    const key = `feat:${traiteurId}`;
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          return new Set(parsed);
        }
      }
    } catch {
      // Cache indisponible : lecture directe en base
    }

    const rows = await this.prisma.featureFlag.findMany({
      where: { traiteurId, enabled: true },
      select: { key: true },
    });
    const enabled = new Set(rows.map((row) => row.key));

    try {
      await this.redis.set(key, JSON.stringify([...enabled]), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Écriture du cache impossible : ${String(error)}`);
    }
    return enabled;
  }

  async invalidate(traiteurId: string): Promise<void> {
    try {
      await this.redis.del(`feat:${traiteurId}`);
    } catch (error) {
      this.logger.warn(`Invalidation du cache impossible : ${String(error)}`);
    }
  }
}
