import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';

import { webSentryOptions } from './sentry-options';

const TOKEN = 'k3Q9x_TzP8mLwR2vN5bY7cJ1hF4dG6sA0eU-iOpQrSt';

describe('Sentry du back-office : aucune donnée personnelle', () => {
  for (const side of ['server', 'browser'] as const) {
    it(`${side} : collecte désactivée, ni Replay ni traces`, () => {
      const options = webSentryOptions(side, { dsn: 'https://cle@o0.ingest.sentry.io/1' });
      expect(options.dataCollection).toMatchObject({
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      });
      expect(options.replaysSessionSampleRate).toBe(0);
      expect(options.replaysOnErrorSampleRate).toBe(0);
      expect(options.tracesSampleRate).toBe(0);
    });
  }

  it('filtre un événement du navigateur (lien de devis, utilisateur, fil d’Ariane)', async () => {
    const options = webSentryOptions('browser', { dsn: 'https://cle@o0.ingest.sentry.io/1' });
    const event = {
      type: undefined,
      message: 'Échec du chargement pour salma@exemple.ma',
      user: { email: 'salma@exemple.ma', ip_address: '41.250.1.2' },
      request: {
        url: `https://app.exemple.ma/devis/${TOKEN}?lang=ar`,
        headers: { Cookie: 'traiteur_refresh=secret', 'User-Agent': 'Mozilla/5.0' },
      },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/admin', to: `/invitation/${TOKEN}` } },
      ],
      extra: { form: { phone: '0612345678', firstName: 'Salma' } },
    } as unknown as ErrorEvent;
    const sent = JSON.stringify(await options.beforeSend?.(event, {}));
    for (const secret of [
      TOKEN,
      'salma@exemple.ma',
      '41.250.1.2',
      'traiteur_refresh',
      '0612345678',
      'Salma',
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).toContain('/devis/[jeton]');
  });
});
