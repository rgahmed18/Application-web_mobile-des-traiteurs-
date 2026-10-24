import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { normalizeIpAddress } from './ip-address';

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getClientInfo(request: Request): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: normalizeIpAddress(request.ip),
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}

/** Injecte l'IP et le user-agent de l'appelant (journalisation, sessions). */
export const Client = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientInfo =>
    getClientInfo(context.switchToHttp().getRequest<Request>()),
);
