import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * En-têtes des pages publiques à jeton (devis) : jamais indexées, jamais mises en cache, et
 * aucun « Referer » transmis aux sites liés (le jeton ne doit pas fuiter). Posés avant le
 * traitement : ils accompagnent aussi les réponses d'erreur.
 */
export class PublicDocumentHeaders implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
