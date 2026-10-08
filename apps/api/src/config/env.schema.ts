import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const secret = (name: string) => z.string().min(32, `${name} doit contenir au moins 32 caractères`);

/** Liste séparée par des virgules ("a, b,c" → ["a", "b", "c"]). */
const commaList = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

/**
 * Réglage « trust proxy » d'Express, qui détermine l'IP réelle du client (request.ip) :
 *   false (défaut)    → l'IP de la connexion TCP, aucun en-tête X-Forwarded-For n'est lu
 *   true              → un seul proxy de confiance devant l'API (équivaut à 1)
 *   N                 → N proxys de confiance (ex. CDN + load balancer = 2)
 *   liste d'adresses  → proxys de confiance par IP / sous-réseau (ex. "loopback, 10.0.0.0/8")
 * Ne jamais l'activer sans proxy : un client pourrait alors falsifier son IP.
 */
export type TrustProxySetting = false | number | string[];

const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((value): TrustProxySetting => {
    if (value === '' || value === 'false') return false;
    if (value === 'true') return 1;
    if (/^\d+$/.test(value)) return Number(value);
    return value.split(',').map((item) => item.trim());
  })
  .refine((value) => value !== 0 && (!Array.isArray(value) || value.every(Boolean)), {
    message: 'valeur invalide (false, true, nombre de proxys ou liste d’adresses)',
  });

const countryCode = z.string().regex(/^[1-9]\d{0,3}$/, 'indicatif pays invalide (ex. 212)');

/** Schéma des variables d'environnement : l'API refuse de démarrer si elles sont invalides. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    SWAGGER_ENABLED: booleanString,
    /** À activer derrière un reverse proxy (IP réelle du client pour la limitation de débit). */
    TRUST_PROXY: trustProxy,

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /** Clé HMAC des codes OTP : un vol de la base ne permet pas de retrouver les codes. */
    OTP_SECRET: secret('OTP_SECRET'),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
    OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
    /** Demandes de code par adresse IP sur 24 h glissantes, tous numéros confondus. */
    OTP_MAX_PER_IP_PER_DAY: z.coerce.number().int().min(1).default(20),
    SMS_PROVIDER: z.enum(['console']).default('console'),
    /** Plafond global de SMS envoyés sur 24 h glissantes (protection contre le « SMS pumping »). */
    SMS_DAILY_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(2000),
    /** Indicatifs pays autorisés à recevoir un SMS, sans « + » (ex. "212,33"). */
    SMS_ALLOWED_COUNTRY_CODES: commaList('212').pipe(
      z.array(countryCode).min(1, 'au moins un indicatif est requis'),
    ),

    /** Échecs de connexion consécutifs avant le premier verrouillage du compte. */
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(50).default(5),
    /** Durées de verrouillage progressives en minutes ; la dernière s'applique ensuite. */
    LOGIN_LOCKOUT_MINUTES: commaList('1,5,15,60,240,1440').pipe(
      z
        .array(
          z
            .string()
            .regex(/^\d+$/, 'durée en minutes attendue')
            .transform(Number)
            .pipe(z.number().int().positive()),
        )
        .min(1, 'au moins une durée est requise'),
    ),

    /** Stockage S3 des photos : RustFS en développement, Cloudflare R2 en production. */
    S3_ENDPOINT: z.url(),
    /** « auto » pour Cloudflare R2. */
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).default('traiteur-media'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    /** Adressage « endpoint/bucket/clé » (RustFS, MinIO) plutôt que « bucket.endpoint/clé ». */
    S3_FORCE_PATH_STYLE: booleanString,
    /** Base publique des photos traitées (domaine R2 ou CDN en production). */
    S3_PUBLIC_URL: z.url(),
    /** Crée le bucket, sa lecture publique et son CORS au démarrage (développement, CI). */
    S3_AUTO_SETUP: booleanString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: "le fournisseur SMS simulé 'console' est interdit en production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Utilisé par ConfigModule : transforme les erreurs Zod en message lisible. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables d'environnement invalides :\n${details}`);
  }
  return result.data;
}
