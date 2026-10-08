import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getClientInfo(request: Request): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}

/** Injecte l'IP et le user-agent de l'appelant (journalisation, sessions). */
export const Client = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientInfo =>
    getClientInfo(context.switchToHttp().getRequest<Request>()),
);
