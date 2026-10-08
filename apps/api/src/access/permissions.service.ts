import { Inject, Injectable, Logger } from '@nestjs/common';
import { PERMISSION_KEYS, resolveEffectivePermissions, TENANT_ROLES } from '@traiteur/shared';
import type { Redis } from 'ioredis';

import type { Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 300;
const VERSION_KEY = 'perm:version';

/**
 * Permissions effectives d'un rôle chez un traiteur, lues en base :
 * matrice par défaut (traiteurId = null) + surcharges du traiteur (hors permissions critiques).
 * Résultat mis en cache dans Redis ; si Redis est indisponible, on lit directement la base.
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getEffectivePermissions(traiteurId: string | null, role: Role): Promise<Set<string>> {
    if (role === 'SUPER_ADMIN') return new Set(PERMISSION_KEYS);
    if (!traiteurId) return new Set();

    const cacheKey = await this.cacheKey(traiteurId, role);
    const cached = cacheKey ? await this.readCache(cacheKey) : null;
    if (cached) return cached;

    const permissions = await this.loadFromDatabase(traiteurId, role);
    if (cacheKey) await this.writeCache(cacheKey, permissions);
    return permissions;
  }

  async hasAll(
    traiteurId: string | null,
    role: Role,
    required: readonly string[],
  ): Promise<boolean> {
    const effective = await this.getEffectivePermissions(traiteurId, role);
    return required.every((key) => effective.has(key));
  }

  /** À appeler après une modification des surcharges d'un traiteur. */
  async invalidateTenant(traiteurId: string): Promise<void> {
    try {
      const version = await this.currentVersion();
      await this.redis.del(...TENANT_ROLES.map((role) => this.key(version, traiteurId, role)));
    } catch (error) {
      this.logger.warn(`Invalidation du cache impossible : ${String(error)}`);
    }
  }

  /** À appeler après une modification de la matrice par défaut (concerne tous les traiteurs). */
  async invalidateAll(): Promise<void> {
    try {
      await this.redis.incr(VERSION_KEY);
    } catch (error) {
      this.logger.warn(`Invalidation du cache impossible : ${String(error)}`);
    }
  }

  private async loadFromDatabase(traiteurId: string, role: Role): Promise<Set<string>> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { role, OR: [{ traiteurId: null }, { traiteurId }] },
      select: {
        traiteurId: true,
        granted: true,
        permission: { select: { key: true, isTenantEditable: true } },
      },
    });

    const toRule = (row: (typeof rows)[number]) => ({
      permissionKey: row.permission.key,
      granted: row.granted,
    });
    const nonEditable = new Set(
      rows.filter((row) => !row.permission.isTenantEditable).map((row) => row.permission.key),
    );
    return resolveEffectivePermissions(
      rows.filter((row) => row.traiteurId === null).map(toRule),
      rows.filter((row) => row.traiteurId !== null).map(toRule),
      nonEditable,
    );
  }

  private key(version: string, traiteurId: string, role: Role): string {
    return `perm:v${version}:${traiteurId}:${role}`;
  }

  private async currentVersion(): Promise<string> {
    return (await this.redis.get(VERSION_KEY)) ?? '0';
  }

  private async cacheKey(traiteurId: string, role: Role): Promise<string | null> {
    try {
      return this.key(await this.currentVersion(), traiteurId, role);
    } catch {
      return null;
    }
  }

  private async readCache(key: string): Promise<Set<string> | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
        ? new Set(parsed)
        : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, permissions: Set<string>): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify([...permissions]), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Écriture du cache impossible : ${String(error)}`);
    }
  }
}
