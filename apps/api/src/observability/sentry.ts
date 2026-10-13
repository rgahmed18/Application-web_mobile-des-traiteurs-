import * as Sentry from '@sentry/node';
import {
  NO_PERSONAL_DATA_COLLECTION,
  scrubBreadcrumb,
  scrubEvent,
  scrubSpan,
} from '@traiteur/shared';

export type ObservedService = 'api' | 'worker';

export interface SentrySettings {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  /** Tests : transport de remplacement (aucun envoi réel). */
  transport?: Sentry.NodeOptions['transport'];
}

/**
 * Options Sentry communes à l'API et au worker. Aucune donnée personnelle ni aucun secret ne
 * part : collecte du SDK entièrement désactivée (dataCollection, qui remplace sendDefaultPii en
 * v11), et chaque événement, transaction et fil d'Ariane passe par le filtre partagé
 * (packages/shared/src/observability/scrub.ts).
 */
export function sentryOptions(
  service: ObservedService,
  settings: SentrySettings,
): Sentry.NodeOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment ?? 'development',
    release: settings.release,
    // Équivalent de sendDefaultPii: false en v11 : aucune collecte de données personnelles
    dataCollection: { ...NO_PERSONAL_DATA_COLLECTION, httpBodies: [] },
    // Nom de machine inutile au diagnostic : non transmis
    serverName: service,
    initialScope: { tags: { service } },
    tracesSampleRate: settings.tracesSampleRate ?? 0,
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEvent(event),
    // v11 : les traces partent span par span (beforeSendSpan remplace beforeSendTransaction)
    beforeSendSpan: (span) => scrubSpan(span),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    ...(settings.transport ? { transport: settings.transport } : {}),
  };
}

/** Active Sentry si un DSN est configuré ; sinon rien n'est envoyé (développement, tests). */
export function initSentry(service: ObservedService, settings: SentrySettings): boolean {
  if (!settings.dsn) return false;
  Sentry.init(sentryOptions(service, settings));
  return true;
}

/** Lecture des variables SENTRY_* (avant toute autre initialisation). */
export function sentrySettingsFromEnv(env: NodeJS.ProcessEnv = process.env): SentrySettings {
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? '0');
  return {
    dsn: env.SENTRY_DSN || undefined,
    environment: env.SENTRY_ENVIRONMENT || undefined,
    release: env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0,
  };
}
