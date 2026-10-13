/**
 * Filtrage des rapports d'erreur (Sentry) : AUCUNE donnée personnelle ni aucun secret ne doit
 * quitter nos serveurs. Utilisé par l'API, le worker et le back-office (beforeSend,
 * beforeSendTransaction, beforeBreadcrumb), en plus de sendDefaultPii: false.
 *
 * Trois niveaux :
 *   1. suppression de blocs entiers : corps des requêtes, cookies, en-têtes (sauf une courte
 *      liste sûre), paramètres d'URL, utilisateur, variables locales des traces ;
 *   2. masquage des valeurs dont le NOM est sensible (mot de passe, jeton, téléphone, e-mail,
 *      nom, adresse…), à toute profondeur ;
 *   3. masquage, dans TOUS les textes restants (messages d'erreur, URL, fil d'Ariane), des
 *      e-mails, téléphones, jetons (JWT, Bearer, liens de devis et d'invitation).
 */

export const REDACTED = '[masqué]';

/** Noms de champs dont la valeur est toujours masquée. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authori[sz]ation|cookie|session|api[-_]?key|access[-_]?key|private[-_]?key|dsn|otp|phone|t[ée]l[ée]phone|mobile|e-?mail|courriel|^name$|(first|last|full|display|user|client|contact|member|legal|recorded|actor|driver)[-_]?name$|^nom$|pr[ée]nom|address|adresse|street|iban|rib$|^ice$|cnss|tax[-_]?id|identifier|ip[-_]?address|^ip$|signature|birth/i;

/** Contextes techniques ajoutés par le SDK, jamais personnels. */
const TECHNICAL_CONTEXTS = new Set([
  'os',
  'runtime',
  'app',
  'device',
  'culture',
  'trace',
  'cloud_resource',
]);

/** En-têtes conservés : rien d'identifiant (ni Authorization, ni Cookie, ni X-Forwarded-For). */
const SAFE_HEADERS = new Set(['content-type', 'content-length', 'accept', 'accept-language']);

const TEXT_PATTERNS: [RegExp, string][] = [
  // Jetons JWT (eyJ…eyJ…signature)
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[jeton]'],
  // Authorization: Bearer xxx / Basic xxx
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [jeton]'],
  // Liens sécurisés : /devis/<jeton>, /invitation/<jeton>, /public/quotes/<jeton>…
  [/\/(devis|invitation|invitations|quotes)\/[A-Za-z0-9_-]{20,}/gi, '/$1/[jeton]'],
  // Paramètres d'URL sensibles
  [
    /([?&](?:token|key|apikey|api_key|password|code|secret|signature|to|phone|mobile|msisdn|recipient|dest|X-Amz-[A-Za-z]+)=)[^&#\s"]+/gi,
    '$1[masqué]',
  ],
  // Jeton opaque isolé de 43 caractères base64url (newLinkToken)
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '[jeton]'],
  // Adresses e-mail
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail]'],
  // Téléphones : +212…, 00212…, 06…/07…/05…, numéros internationaux
  [/(?:\+|00)\d[\d\s.-]{7,16}\d/g, '[téléphone]'],
  [/(?<!\d)0[5-7](?:[\s.-]?\d){8}(?!\d)/g, '[téléphone]'],
  // Numéro marocain sans « + » (212612345678), format de nombreux agrégateurs SMS
  [/(?<!\d)212[5-7]\d{8}(?!\d)/g, '[téléphone]'],
];

/** Masque e-mails, téléphones et jetons dans un texte. */
export function scrubText(text: string): string {
  return TEXT_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(child, depth + 1);
    }
    return result;
  }
  return value;
}

/** Masque récursivement un objet quelconque (données d'un fil d'Ariane, contexte…). */
export function scrubData<T>(value: T): T {
  return scrubValue(value, 0) as T;
}

interface ScrubbableRequest {
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface ScrubbableFrame {
  vars?: unknown;
  [key: string]: unknown;
}

/** Forme minimale d'un événement Sentry (erreur ou transaction) manipulée ici. */
export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  user?: unknown;
  exception?: { values?: { stacktrace?: { frames?: ScrubbableFrame[] } }[] };
  breadcrumbs?: unknown[];
  [key: string]: unknown;
}

/** Filtre un événement avant son envoi : voir l'en-tête du fichier. */
export function scrubEvent<T extends object>(event: T): T {
  const copy = { ...event } as ScrubbableEvent;
  if (copy.request) {
    const headers = Object.fromEntries(
      Object.entries(copy.request.headers ?? {}).filter(([name]) =>
        SAFE_HEADERS.has(name.toLowerCase()),
      ),
    );
    copy.request = {
      method: copy.request.method,
      url: copy.request.url ? scrubText(copy.request.url.split('?')[0] ?? '') : undefined,
      headers,
    };
  }
  delete copy.user;
  if (copy.exception?.values) {
    copy.exception = {
      ...copy.exception,
      values: copy.exception.values.map((value) => ({
        ...value,
        stacktrace: value.stacktrace
          ? {
              ...value.stacktrace,
              frames: value.stacktrace.frames?.map(({ vars: _vars, ...frame }) => frame),
            }
          : undefined,
      })),
    };
  }
  // Sections techniques du SDK (nom et version du SDK, système, environnement d'exécution) :
  // aucune donnée personnelle, conservées telles quelles pour le diagnostic
  const { sdk, contexts, ...rest } = copy;
  const technical: Record<string, unknown> = {};
  const other: Record<string, unknown> = {};
  for (const [name, context] of Object.entries((contexts ?? {}) as Record<string, unknown>)) {
    if (TECHNICAL_CONTEXTS.has(name)) technical[name] = context;
    else other[name] = context;
  }
  const scrubbed = scrubData<ScrubbableEvent>(rest);
  return {
    ...scrubbed,
    ...(sdk === undefined ? {} : { sdk }),
    ...(contexts === undefined ? {} : { contexts: { ...technical, ...scrubData(other) } }),
  } as T;
}

function scrubTexts(value: unknown, depth: number): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubTexts(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, scrubTexts(child, depth + 1)]),
    );
  }
  return value;
}

/**
 * Span de performance (envoyé un par un en v11) : URL, requêtes et descriptions masquées
 * (e-mails, téléphones, jetons), sans toucher aux identifiants techniques du span.
 */
export function scrubSpan<T>(span: T): T {
  return scrubTexts(span, 0) as T;
}

/** Fil d'Ariane (requêtes, journaux) : textes et données masqués ; corps jamais conservé. */
export function scrubBreadcrumb<T extends { message?: string; data?: unknown }>(breadcrumb: T): T {
  const { data, ...rest } = breadcrumb;
  const safeData =
    data && typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data as Record<string, unknown>).filter(
            ([key]) => !/body|payload|request|response/i.test(key),
          ),
        )
      : undefined;
  return scrubData({ ...rest, ...(safeData ? { data: safeData } : {}) }) as T;
}

/**
 * Collecte du SDK Sentry (v11, option `dataCollection`, qui remplace `sendDefaultPii`) : TOUT
 * est désactivé. Les valeurs par défaut du SDK collectent utilisateur, cookies, en-têtes, corps
 * des requêtes, paramètres d'URL, données SQL, arguments des tâches et variables locales.
 * Le filtrage scrubEvent s'applique en plus, au cas où une donnée passerait malgré tout.
 */
export const NO_PERSONAL_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  // Aucun extrait de code source joint aux traces (une valeur sensible pourrait y figurer)
  frameContextLines: 0,
} as const;
