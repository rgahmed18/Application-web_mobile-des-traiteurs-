export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

/** Convertit une URL redis:// ou rediss:// en options de connexion (BullMQ / ioredis). */
export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const options: RedisConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const db = url.pathname.replace('/', '');
  if (db) options.db = Number(db);
  if (url.protocol === 'rediss:') options.tls = {};
  return options;
}
