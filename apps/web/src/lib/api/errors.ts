/**
 * Erreurs de l'API : codes stables traduits en messages clairs (messages/*.json → errors.api).
 */

/** Codes pour lesquels un message traduit existe. */
export const TRANSLATED_ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'INVALID_TOKEN',
  'TOKEN_REUSED',
  'INVALID_OTP',
  'OTP_LOCKED',
  'OTP_RATE_LIMITED',
  'ACCOUNT_EXISTS',
  'EMAIL_TAKEN',
  'PROFILE_REQUIRED',
  'ACCOUNT_DISABLED',
  'TRAITEUR_REQUIRED',
  'TRAITEUR_NOT_FOUND',
  'TRAITEUR_UNAVAILABLE',
  'MEMBERSHIP_INACTIVE',
  'TENANT_MISMATCH',
  'FORBIDDEN_ROLE',
  'MISSING_PERMISSION',
  'FEATURE_DISABLED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'SLUG_TAKEN',
  'ITEM_IN_USE',
  'IMAGE_INVALID',
  'IMAGE_TOO_LARGE',
  'UPLOAD_NOT_FOUND',
  'DOCUMENT_NOT_FOUND',
  'LINE_NOT_FOUND',
  'TOO_MANY_REQUESTS',
  'NO_BACKOFFICE_ACCESS',
  'API_UNREACHABLE',
  'DISH_IN_PACKAGE',
  'ITEM_ARCHIVED',
  'CLIENT_EXISTS',
  'PHONE_IS_STAFF',
  'ORDER_VERSION_CONFLICT',
  'AVAILABILITY_CONFLICT',
  'INVALID_TRANSITION',
  'REASON_REQUIRED',
  'ORDER_LOCKED',
  'LINES_REQUIRED',
  'INVALID_TAX_RATE',
  'INVALID_PERIOD',
] as const;
export type TranslatedErrorCode = (typeof TRANSLATED_ERROR_CODES)[number];

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly retryAfterSeconds: number | null = null,
    /** Corps complet de l'erreur : détails propres au code (disponibilité, auteur…). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Erreur réseau (serveur injoignable, coupure) : distincte d'une erreur renvoyée par l'API. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Serveur injoignable', { cause });
    this.name = 'NetworkError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Construit une ApiError à partir d'une réponse HTTP en échec. */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Corps absent ou non JSON
  }
  const record = isRecord(body) ? body : {};
  const code =
    typeof record.code === 'string'
      ? record.code
      : response.status === 429
        ? 'TOO_MANY_REQUESTS' // limiteur de débit : réponse sans code applicatif
        : response.status === 404
          ? 'NOT_FOUND'
          : `HTTP_${response.status}`;
  const issues = Array.isArray(record.issues)
    ? record.issues.filter(
        (issue): issue is ValidationIssue =>
          isRecord(issue) && typeof issue.path === 'string' && typeof issue.message === 'string',
      )
    : [];
  const retryAfter = typeof record.retryAfterSeconds === 'number' ? record.retryAfterSeconds : null;
  return new ApiError(
    response.status,
    code,
    typeof record.message === 'string' ? record.message : response.statusText,
    issues,
    retryAfter,
    record,
  );
}

export type ErrorMessageKey = `api.${TranslatedErrorCode}` | 'generic' | 'network';

/** Clé de traduction (espace « errors ») d'une erreur quelconque. */
export function errorMessageKey(error: unknown): ErrorMessageKey {
  if (error instanceof NetworkError) return 'network';
  if (isApiError(error) && (TRANSLATED_ERROR_CODES as readonly string[]).includes(error.code)) {
    return `api.${error.code as TranslatedErrorCode}`;
  }
  return 'generic';
}
