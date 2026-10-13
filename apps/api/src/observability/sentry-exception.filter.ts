import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Envoie à Sentry les erreurs inattendues (exceptions non HTTP et réponses 5xx), puis laisse
 * Nest répondre comme d'habitude. Les erreurs métier (4xx : validation, droits, conflits) ne
 * sont pas des incidents et ne sont pas envoyées. Sans DSN configuré, l'envoi est sans effet.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) Sentry.captureException(exception);
    super.catch(exception, host);
  }
}

/** Échec d'une tâche BullMQ (après ses éventuelles nouvelles tentatives). */
export function reportJobFailure(queue: string, jobName: string, error: Error): void {
  Sentry.captureException(error, { tags: { queue, job: jobName } });
}
