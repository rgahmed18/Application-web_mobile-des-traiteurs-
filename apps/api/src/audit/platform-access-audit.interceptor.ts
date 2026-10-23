import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, concatMap, from, map, type Observable, throwError } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/auth-user';
import { getClientInfo } from '../common/http/client-info';
import { AuditService } from './audit.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Déjà tracées par le service (prolongation, sortie). */
const SELF_AUDITED = /\/platform\/access\/(extend|leave)$/;

/**
 * Super admin entré chez un traiteur : chaque modification (POST, PUT, PATCH, DELETE) est tracée
 * dans le journal du traiteur (méthode, route, statut), qu'elle réussisse ou échoue.
 */
@Injectable()
export class PlatformAccessAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PlatformAccessAuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const path = request.path;
    if (
      !user?.platformAccessId ||
      !user.traiteurId ||
      READ_METHODS.has(request.method) ||
      SELF_AUDITED.test(path)
    ) {
      return next.handle();
    }

    const record = (status: number) =>
      from(
        this.audit
          .record({
            traiteurId: user.traiteurId,
            actor: user,
            action: 'platform.access_request',
            entityType: 'PlatformAccess',
            entityId: user.platformAccessId,
            after: { method: request.method, path, status },
            client: getClientInfo(request),
          })
          .catch((error: unknown) => {
            this.logger.error(`Audit de l'accès plateforme impossible : ${String(error)}`);
          }),
      );

    return next.handle().pipe(
      concatMap((value: unknown) =>
        record(context.switchToHttp().getResponse<Response>().statusCode).pipe(map(() => value)),
      ),
      catchError((error: unknown) =>
        record(error instanceof HttpException ? error.getStatus() : 500).pipe(
          concatMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}
