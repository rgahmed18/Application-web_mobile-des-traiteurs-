import * as Sentry from '@sentry/nextjs';

import { webSentryOptions } from '@/lib/observability/sentry-options';

/** Serveur Next : suivi des erreurs actif seulement si SENTRY_DSN est renseigné. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Configuration vérifiée au démarrage : une variable invalide (ou le mode démo en production)
  // arrête le serveur au lieu d'échouer à la première requête
  const { serverEnv } = await import('@/lib/env/server');
  serverEnv();
  if (!process.env.SENTRY_DSN) return;
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
