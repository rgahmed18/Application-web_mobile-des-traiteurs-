import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/** Forme du résultat attendu par ThrottlerGuard (durées en secondes). */
export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fenêtre fixe atomique : incrément du compteur, expiration à la première requête de la
 * fenêtre, puis blocage pendant blockDuration une fois la limite dépassée.
 * Retourne { totalHits, ttlMs du compteur, bloqué (0/1), ttlMs du blocage }.
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or limit + 1)
  return { hits, redis.call('PTTL', hitsKey), 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local hitsTtl = redis.call('PTTL', hitsKey)

if hits > limit then
  if blockDuration > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockDuration)
    return { hits, hitsTtl, 1, blockDuration }
  end
  return { hits, hitsTtl, 1, hitsTtl }
end
return { hits, hitsTtl, 0, 0 }
`;

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

function parseReply(reply: unknown): [number, number, number, number] {
  if (Array.isArray(reply)) {
    const values: readonly unknown[] = reply;
    const [hits, hitsTtl, blocked, blockTtl] = values;
    if (
      typeof hits === 'number' &&
      typeof hitsTtl === 'number' &&
      typeof blocked === 'number' &&
      typeof blockTtl === 'number'
    ) {
      return [hits, hitsTtl, blocked, blockTtl];
    }
  }
  throw new Error('Réponse inattendue du script de limitation de débit');
}

/**
 * Stockage Redis des compteurs du limiteur de débit (@nestjs/throttler) :
 * partagé entre toutes les instances de l'API et conservé après un redémarrage.
 *
 * Si Redis est indisponible, la requête est laissée passer (journalisé en warn) : la
 * limitation de débit est une protection de confort, les protections critiques (verrouillage
 * des comptes, quotas SMS) reposent sur PostgreSQL.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'throttle',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    try {
      const reply: unknown = await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:blocked`,
        ttl,
        limit,
        blockDuration,
      );
      const [totalHits, hitsTtlMs, blocked, blockTtlMs] = parseReply(reply);
      return {
        totalHits,
        timeToExpire: toSeconds(hitsTtlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockTtlMs),
      };
    } catch (error) {
      this.logger.warn(`Limitation de débit inactive (Redis indisponible) : ${String(error)}`);
      return { totalHits: 0, timeToExpire: toSeconds(ttl), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
