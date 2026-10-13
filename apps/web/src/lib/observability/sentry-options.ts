import type { BrowserOptions, NodeOptions } from '@sentry/nextjs';
import {
  NO_PERSONAL_DATA_COLLECTION,
  scrubBreadcrumb,
  scrubEvent,
  scrubSpan,
} from '@traiteur/shared';

export interface WebSentrySettings {
  dsn?: string;
  environment?: string;
  release?: string;
}

/**
 * Options Sentry du back-office (serveur Next et navigateur). Aucune donnée personnelle ni
 * aucun secret : collecte du SDK entièrement désactivée (dataCollection, qui remplace
 * sendDefaultPii en v11), filtrage partagé de chaque événement et fil d'Ariane, pas de
 * Session Replay (il enregistrerait les écrans, donc les données affichées), pas de traces
 * de performance.
 */
export function webSentryOptions(
  side: 'server' | 'browser',
  settings: WebSentrySettings,
): NodeOptions & BrowserOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment ?? 'development',
    release: settings.release,
    dataCollection: { ...NO_PERSONAL_DATA_COLLECTION, httpBodies: [] },
    initialScope: { tags: { service: side === 'server' ? 'web-server' : 'web-browser' } },
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEvent(event),
    // v11 : les traces partent span par span (beforeSendSpan remplace beforeSendTransaction)
    beforeSendSpan: (span) => scrubSpan(span),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}
