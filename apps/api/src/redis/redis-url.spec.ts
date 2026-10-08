import { parseRedisUrl } from './redis-url';

describe('parseRedisUrl', () => {
  it('lit une URL locale simple', () => {
    expect(parseRedisUrl('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
  });

  it('lit identifiants, base et TLS', () => {
    expect(parseRedisUrl('rediss://user:p%40ss@cache.example.ma:6380/2')).toEqual({
      host: 'cache.example.ma',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });

  it('utilise le port par défaut', () => {
    expect(parseRedisUrl('redis://redis').port).toBe(6379);
  });
});
