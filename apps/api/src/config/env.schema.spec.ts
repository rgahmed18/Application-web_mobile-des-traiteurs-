import { validateEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'cle',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_URL: 'http://localhost:9000/traiteur-media',
};

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.SMS_PROVIDER).toBe('console');
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

  it('refuse un secret trop court', () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'court' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => validateEnv({ ...validEnv, OTP_SECRET: 'court' })).toThrow(/OTP_SECRET/);
  });

  it('refuse une URL de base de données absente ou invalide', () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('applique les protections par défaut (SMS Maroc uniquement, verrouillage progressif)', () => {
    const env = validateEnv(validEnv);
    expect(env.SMS_ALLOWED_COUNTRY_CODES).toEqual(['212']);
    expect(env.OTP_MAX_PER_IP_PER_DAY).toBe(20);
    expect(env.SMS_DAILY_GLOBAL_LIMIT).toBe(2000);
    expect(env.LOGIN_MAX_FAILURES).toBe(5);
    expect(env.LOGIN_LOCKOUT_MINUTES).toEqual([1, 5, 15, 60, 240, 1440]);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('lit les listes configurables', () => {
    const env = validateEnv({
      ...validEnv,
      SMS_ALLOWED_COUNTRY_CODES: '212, 33',
      LOGIN_LOCKOUT_MINUTES: '2,10',
    });
    expect(env.SMS_ALLOWED_COUNTRY_CODES).toEqual(['212', '33']);
    expect(env.LOGIN_LOCKOUT_MINUTES).toEqual([2, 10]);
  });

  it('refuse un indicatif pays invalide', () => {
    expect(() => validateEnv({ ...validEnv, SMS_ALLOWED_COUNTRY_CODES: '+212' })).toThrow(
      /SMS_ALLOWED_COUNTRY_CODES/,
    );
  });

  it.each([
    ['false', false],
    ['true', 1],
    ['2', 2],
    ['loopback, 10.0.0.0/8', ['loopback', '10.0.0.0/8']],
  ])('interprète TRUST_PROXY=%s', (value, expected) => {
    expect(validateEnv({ ...validEnv, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it('refuse TRUST_PROXY=0', () => {
    expect(() => validateEnv({ ...validEnv, TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
  });

  it('exige la configuration du stockage des photos', () => {
    expect(() => validateEnv({ ...validEnv, S3_ENDPOINT: undefined })).toThrow(/S3_ENDPOINT/);
    expect(validateEnv(validEnv)).toMatchObject({
      S3_BUCKET: 'traiteur-media',
      S3_AUTO_SETUP: false,
    });
  });

  it('interdit le fournisseur SMS simulé en production', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
  });
});
