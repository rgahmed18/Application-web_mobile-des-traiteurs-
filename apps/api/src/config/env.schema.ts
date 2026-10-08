import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const secret = (name: string) => z.string().min(32, `${name} doit contenir au moins 32 caractères`);

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
    TRUST_PROXY: booleanString,

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
    SMS_PROVIDER: z.enum(['console']).default('console'),
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
