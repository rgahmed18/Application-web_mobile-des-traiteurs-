import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/** Codes d'erreur stables, exploitables par les clients (traduction côté app). */
export type AppErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'TOKEN_REUSED'
  | 'INVALID_OTP'
  | 'OTP_LOCKED'
  | 'OTP_RATE_LIMITED'
  | 'ACCOUNT_EXISTS'
  | 'EMAIL_TAKEN'
  | 'PROFILE_REQUIRED'
  | 'ACCOUNT_DISABLED'
  | 'TRAITEUR_REQUIRED'
  | 'TRAITEUR_NOT_FOUND'
  | 'TRAITEUR_UNAVAILABLE'
  | 'MEMBERSHIP_INACTIVE'
  | 'TENANT_MISMATCH'
  | 'FORBIDDEN_ROLE'
  | 'MISSING_PERMISSION'
  | 'FEATURE_DISABLED'
  | 'DOCUMENT_NOT_FOUND'
  | 'LINE_NOT_FOUND';

export interface AppErrorBody {
  code: AppErrorCode;
  message: string;
  [key: string]: unknown;
}

function body(code: AppErrorCode, message: string, extra?: Record<string, unknown>): AppErrorBody {
  return { code, message, ...extra };
}

export const appErrors = {
  badRequest: (code: AppErrorCode, message: string, extra?: Record<string, unknown>) =>
    new BadRequestException(body(code, message, extra)),
  unauthorized: (code: AppErrorCode, message: string) =>
    new UnauthorizedException(body(code, message)),
  forbidden: (code: AppErrorCode, message: string) => new ForbiddenException(body(code, message)),
  notFound: (code: AppErrorCode, message: string) => new NotFoundException(body(code, message)),
  conflict: (code: AppErrorCode, message: string) => new ConflictException(body(code, message)),
  tooManyRequests: (code: AppErrorCode, message: string, extra?: Record<string, unknown>) =>
    new HttpException(body(code, message, extra), HttpStatus.TOO_MANY_REQUESTS),
};

/** Extrait le code d'une erreur applicative (utile dans les tests). */
export function getErrorCode(error: unknown): AppErrorCode | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response === 'object' && 'code' in response) {
    return (response as AppErrorBody).code;
  }
  return undefined;
}
