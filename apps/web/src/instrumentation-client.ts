import * as Sentry from '@sentry/nextjs';

import { webSentryOptions } from '@/lib/observability/sentry-options';

// Navigateur : DSN publié dans la page au démarrage du serveur (window.__PUBLIC_ENV__)
const published = typeof window === 'undefined' ? undefined : window.__PUBLIC_ENV__;
if (published?.PUBLIC_SENTRY_DSN) {
  Sentry.init(
    webSentryOptions('browser', {
      dsn: published.PUBLIC_SENTRY_DSN,
      environment: published.PUBLIC_SENTRY_ENVIRONMENT,
    }),
  );
}
