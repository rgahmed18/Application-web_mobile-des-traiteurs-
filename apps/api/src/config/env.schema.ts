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
    /** Adresse de la console de la plateforme (lien d'activation d'un super admin). */
    PUBLIC_WEB_URL: z.url().default('http://localhost:3001'),
    /**
     * Domaine des traiteurs : chacun est servi sur « <identifiant>.<TENANT_BASE_DOMAIN> »
     * (production : gestion-traiteurs.ma ; développement : localhost ; démo sur un PC :
     * <IP>.nip.io).
     */
    TENANT_BASE_DOMAIN: z.string().trim().min(1).default('localhost'),
    /** Adresses (sans port) de la console de la plateforme, séparées par des virgules. */
    PLATFORM_HOSTNAMES: z
      .string()
      .default('localhost')
      .transform((value) =>
        value
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter((host) => host.length > 0),
      ),
    /**
     * Adresse d'un traiteur dans les liens envoyés (invitations, devis) ; « {slug} » est remplacé
     * par son identifiant. Un domaine personnalisé vérifié et actif est utilisé à la place.
     */
    TENANT_URL_TEMPLATE: z
      .string()
      .default('http://{slug}.localhost:3001')
      .refine(
        (value) => value.includes('{slug}') && URL.canParse(value.replace('{slug}', 'exemple')),
        'doit être une URL contenant {slug}',
      ),
    /**
     * Démonstration : liste des traiteurs proposée au choix par la page de connexion. Refusé en
     * production (le traiteur vient alors toujours de l'adresse).
     */
    DEMO_SPACE_SELECTION: booleanString,
    /** À activer derrière un reverse proxy (IP réelle du client pour la limitation de débit). */
    TRUST_PROXY: trustProxy,

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /** Clé HMAC des codes OTP : un vol de la base ne permet pas de retrouver les codes. */
    OTP_SECRET: secret('OTP_SECRET'),
    /**
     * Clé de chiffrement des secrets de double authentification (AES-256-GCM). La changer rend
     * les secrets existants illisibles : chaque compte devrait refaire son activation.
     */
    TWO_FACTOR_ENCRYPTION_KEY: secret('TWO_FACTOR_ENCRYPTION_KEY'),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
    OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
    /** Demandes de code par adresse IP sur 24 h glissantes, tous numéros confondus. */
    OTP_MAX_PER_IP_PER_DAY: z.coerce.number().int().min(1).default(20),
    /**
     * Fournisseur SMS : console (simulé, développement), http (agrégateur local, configuré par
     * SMS_HTTP_*), twilio. SMS_FALLBACK_PROVIDER est essayé si le principal échoue.
     */
    SMS_PROVIDER: z.enum(['console', 'http', 'twilio']).default('console'),
    SMS_FALLBACK_PROVIDER: z.enum(['none', 'http', 'twilio']).default('none'),
    /** Délai maximal d'un envoi, par fournisseur. */
    SMS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    /** Nom d'expéditeur (11 caractères au plus, lettres et chiffres), à faire valider. */
    SMS_SENDER: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ]{1,11}$/, '11 caractères au plus, lettres et chiffres')
      .optional(),
    /**
     * Agrégateur HTTP générique. Gabarits {{to}}, {{message}}, {{sender}} dans l'URL et le
     * corps (encodés selon l'endroit). Exemple GET :
     * https://api.exemple.ma/send?key=XXX&to={{to}}&text={{message}}&from={{sender}}
     */
    SMS_HTTP_URL: z
      .string()
      .trim()
      .regex(/^https?:\/\//, 'URL http(s) attendue')
      .optional(),
    SMS_HTTP_METHOD: z.enum(['GET', 'POST']).default('POST'),
    /** Corps de la requête (POST), JSON ou formulaire selon SMS_HTTP_CONTENT_TYPE. */
    SMS_HTTP_BODY: z.string().optional(),
    SMS_HTTP_CONTENT_TYPE: z.enum(['json', 'form']).default('json'),
    /** En-tête Authorization complet (ex. « Bearer xxx ») : secret, jamais journalisé. */
    SMS_HTTP_AUTH_HEADER: z.string().optional(),
    /** Format du numéro attendu : +212612345678, 212612345678 ou 0612345678. */
    SMS_HTTP_PHONE_FORMAT: z.enum(['e164', 'international', 'national']).default('international'),
    /** Expression que la réponse doit contenir pour être un succès (en plus d'un statut 2xx). */
    SMS_HTTP_SUCCESS_PATTERN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z
      .string()
      .regex(/^AC[0-9a-fA-F]{32}$/, 'SID Twilio (AC…)')
      .optional(),
    TWILIO_AUTH_TOKEN: z.string().min(16).optional(),
    /** Numéro ou nom d'expéditeur Twilio ; ou un service de messagerie (MG…). */
    TWILIO_FROM: z.string().trim().min(1).optional(),
    TWILIO_MESSAGING_SERVICE_SID: z
      .string()
      .regex(/^MG[0-9a-fA-F]{32}$/)
      .optional(),
    /** Plafond global de SMS envoyés sur 24 h glissantes (protection contre le « SMS pumping »). */
    SMS_DAILY_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(2000),
    /** Indicatifs pays autorisés à recevoir un SMS, sans « + » (ex. "212,33"). */
    SMS_ALLOWED_COUNTRY_CODES: commaList('212').pipe(
      z.array(countryCode).min(1, 'au moins un indicatif est requis'),
    ),

    /**
     * Suivi des erreurs (Sentry) : actif seulement si SENTRY_DSN est renseigné. Aucune donnée
     * personnelle ni secret envoyé (src/observability). Lues aussi avant le démarrage de Nest.
     */
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.enum(['development', 'staging', 'production']).optional(),
    SENTRY_RELEASE: z.string().max(100).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

    /** Threads de rendu des PDF (Typst) : chacun rend un document à la fois. */
    PDF_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
    /** Délai maximal de rendu d'un document, en millisecondes (thread arrêté au-delà). */
    PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),

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
    /** Photos traitées, lisibles publiquement (domaine public sur ce bucket seulement). */
    S3_BUCKET: z.string().min(3).default('traiteur-media'),
    /** Documents privés et envois bruts : jamais de domaine public sur ce bucket. */
    S3_DOCUMENTS_BUCKET: z.string().min(3).default('traiteur-documents'),
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
    if (env.S3_BUCKET === env.S3_DOCUMENTS_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        message: 'les documents privés doivent être dans un autre bucket que les photos publiques',
        path: ['S3_DOCUMENTS_BUCKET'],
      });
    }
    const providers = [env.SMS_PROVIDER, env.SMS_FALLBACK_PROVIDER];
    if (env.SMS_FALLBACK_PROVIDER === env.SMS_PROVIDER) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_FALLBACK_PROVIDER'],
        message: 'le fournisseur de secours doit différer du fournisseur principal',
      });
    }
    if (providers.includes('http') && !env.SMS_HTTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_HTTP_URL'],
        message: 'requis pour le fournisseur http',
      });
    }
    if (providers.includes('twilio')) {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['TWILIO_ACCOUNT_SID'],
          message: 'TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN requis pour Twilio',
        });
      }
      if (!env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
        ctx.addIssue({
          code: 'custom',
          path: ['TWILIO_FROM'],
          message: 'TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID requis pour Twilio',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.DEMO_SPACE_SELECTION) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_SPACE_SELECTION'],
        message:
          'le choix du traiteur (démonstration) est interdit en production : le traiteur vient de l’adresse',
      });
    }
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
