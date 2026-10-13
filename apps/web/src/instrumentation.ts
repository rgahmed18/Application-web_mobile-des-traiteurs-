import * as Sentry from '@sentry/nextjs';

import { webSentryOptions } from '@/lib/observability/sentry-options';

/** Serveur Next : suivi des erreurs actif seulement si SENTRY_DSN est renseigné. */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_DSN) return;
  Sentry.init(
    webSentryOptions('server', {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT,
      release: process.env.SENTRY_RELEASE,
    }),
  );
}

/** Erreurs des composants serveur et des routes, filtrées comme les autres. */
export const onRequestError = Sentry.captureRequestError;
