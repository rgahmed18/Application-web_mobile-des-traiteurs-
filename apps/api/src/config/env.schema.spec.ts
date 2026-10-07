import { validateEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('convertit les types (nombre, booléen, liste)', () => {
    const env = validateEnv({
      ...validEnv,
      PORT: '4000',
      SWAGGER_ENABLED: 'true',
      CORS_ORIGINS: 'http://a.ma, http://b.ma',
    });
    expect(env.PORT).toBe(4000);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.CORS_ORIGINS).toEqual(['http://a.ma', 'http://b.ma']);
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'court' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuse une URL de base de données absente ou invalide', () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
