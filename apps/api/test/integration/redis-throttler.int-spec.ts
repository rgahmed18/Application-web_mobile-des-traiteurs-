import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { RedisThrottlerStorage } from '../../src/redis/redis-throttler.storage';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('RedisThrottlerStorage (Redis réel)', () => {
  // Deux connexions distinctes = deux instances de l'API
  const instanceA = new Redis(REDIS_URL);
  const instanceB = new Redis(REDIS_URL);
  const prefix = `throttle-test-${randomUUID()}`;

  afterAll(async () => {
    const keys = await instanceA.keys(`${prefix}:*`);
    if (keys.length > 0) await instanceA.del(...keys);
    await Promise.all([instanceA.quit(), instanceB.quit()]);
  });

  it('partage les compteurs entre plusieurs instances de l’API', async () => {
    const a = new RedisThrottlerStorage(instanceA, prefix);
    const b = new RedisThrottlerStorage(instanceB, prefix);
    const key = randomUUID();

    expect((await a.increment(key, 60_000, 3, 60_000, 'default')).totalHits).toBe(1);
    expect((await b.increment(key, 60_000, 3, 60_000, 'default')).totalHits).toBe(2);
    const third = await a.increment(key, 60_000, 3, 60_000, 'default');
    expect(third).toMatchObject({ totalHits: 3, isBlocked: false });
    expect(third.timeToExpire).toBeGreaterThan(0);
    expect(third.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('bloque au-delà de la limite, pour toutes les instances, pendant blockDuration', async () => {
    const a = new RedisThrottlerStorage(instanceA, prefix);
    const b = new RedisThrottlerStorage(instanceB, prefix);
    const key = randomUUID();

    for (let i = 0; i < 2; i += 1) await a.increment(key, 60_000, 2, 120_000, 'default');
    const blocked = await a.increment(key, 60_000, 2, 120_000, 'default');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBeGreaterThan(60);

    const fromOtherInstance = await b.increment(key, 60_000, 2, 120_000, 'default');
    expect(fromOtherInstance.isBlocked).toBe(true);
  });

  it('conserve les compteurs après un redémarrage (nouvelle instance du stockage)', async () => {
    const key = randomUUID();
    await new RedisThrottlerStorage(instanceA, prefix).increment(key, 60_000, 5, 0, 'default');
    const restartedConnection = new Redis(REDIS_URL);
    const afterRestart = new RedisThrottlerStorage(restartedConnection, prefix);
    const record = await afterRestart.increment(key, 60_000, 5, 0, 'default');
    await restartedConnection.quit();
    expect(record.totalHits).toBe(2);
  });

  it('remet le compteur à zéro à la fin de la fenêtre', async () => {
    const storage = new RedisThrottlerStorage(instanceA, prefix);
    const key = randomUUID();
    await storage.increment(key, 200, 1, 0, 'default');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect((await storage.increment(key, 200, 1, 0, 'default')).totalHits).toBe(1);
  });

  it('isole les limiteurs nommés', async () => {
    const storage = new RedisThrottlerStorage(instanceA, prefix);
    const key = randomUUID();
    await storage.increment(key, 60_000, 5, 0, 'default');
    expect((await storage.increment(key, 60_000, 5, 0, 'login')).totalHits).toBe(1);
  });

  it('laisse passer les requêtes si Redis est indisponible', async () => {
    const down = new Redis('redis://localhost:1', {
      lazyConnect: true, // aucune connexion n'est tentée
      enableOfflineQueue: false, // la commande échoue immédiatement au lieu d'attendre
    });
    const storage = new RedisThrottlerStorage(down, prefix);
    const record = await storage.increment(randomUUID(), 60_000, 1, 0, 'default');
    expect(record.isBlocked).toBe(false);
    down.disconnect();
  });
});
