// Navigateurs visés anciens (browserslist, package.json) : le routeur de Next appelle
// structuredClone (Chrome 98, Safari 15.4, Firefox 94) sans vérifier qu'il existe. Le complément
// ne s'installe que si la fonction manque. Les autres fonctions récentes utilisées sont déjà
// complétées par Next (Array.at, Object.hasOwn, URL.canParse) ou testées avant usage.
import 'core-js/actual/structured-clone';

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
