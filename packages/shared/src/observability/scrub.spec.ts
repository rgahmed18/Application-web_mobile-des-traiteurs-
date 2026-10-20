import { describe, expect, it } from 'vitest';

import { REDACTED, scrubBreadcrumb, scrubEvent, scrubSpan, scrubText } from './scrub';

describe('scrubText : limites des motifs (sans assertion arrière)', () => {
  it('garde le caractère qui précède un téléphone ou un jeton masqué', () => {
    expect(scrubText('tel:0612345678, ref 212612345678.')).toBe(
      'tel:[téléphone], ref [téléphone].',
    );
    const token = 'A'.repeat(43);
    expect(scrubText(`lien=${token} et (${token})`)).toBe('lien=[jeton] et ([jeton])');
    expect(scrubText(token)).toBe('[jeton]');
  });

  it('ne masque pas un nombre plus long ni un jeton plus long', () => {
    expect(scrubText('commande 90612345678')).toBe('commande 90612345678');
    expect(scrubText('B'.repeat(44))).toBe('B'.repeat(44));
  });
});

const PERSONAL = [
  '+212612345678',
  '0612345678',
  '06 12 34 56 78',
  'salma.bennani@exemple.ma',
  'Salma',
  'Bennani',
  '12, rue des Orangers',
  'Password123!',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'k3Q9x_TzP8mLwR2vN5bY7cJ1hF4dG6sA0eU-iOpQrSt',
  'cookie-de-session',
  'jeton-twilio-secret',
];

/** Événement réaliste : erreur 500 pendant une requête portant des données personnelles. */
function realisticEvent() {
  return {
    message: 'Échec pour salma.bennani@exemple.ma (+212612345678)',
    user: { id: 'u1', email: 'salma.bennani@exemple.ma', ip_address: '41.250.1.2' },
    request: {
      method: 'POST',
      url: '/api/v1/public/quotes/k3Q9x_TzP8mLwR2vN5bY7cJ1hF4dG6sA0eU-iOpQrSt/accept?token=abc123secret',
      headers: {
        Authorization:
          'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        Cookie: 'traiteur_refresh=cookie-de-session',
        'X-Forwarded-For': '41.250.1.2',
        'content-type': 'application/json',
      },
      cookies: { traiteur_refresh: 'cookie-de-session' },
      data: { phone: '0612345678', password: 'Password123!', firstName: 'Salma' },
      query_string: 'token=abc123secret',
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Client 06 12 34 56 78 introuvable',
          stacktrace: {
            frames: [
              {
                filename: '/app/dist/sms.js',
                function: 'send',
                vars: { password: 'Password123!' },
              },
            ],
          },
        },
      ],
    },
    extra: {
      client: { lastName: 'Bennani', address: '12, rue des Orangers', city: 'Casablanca' },
      twilioAuthToken: 'jeton-twilio-secret',
    },
    contexts: {
      order: { reference: 'CMD-2026-00012', clientName: 'Salma Bennani' },
      runtime: { name: 'node', version: 'v24.19.0' },
    },
    sdk: { name: 'sentry.javascript.node', version: '11.7.0' },
    breadcrumbs: [
      { category: 'http', message: 'POST https://api.exemple.ma/send?key=cle&to=212612345678' },
    ],
  };
}

describe('filtrage des rapports d’erreur', () => {
  it('aucune donnée personnelle ni aucun secret dans l’événement envoyé', () => {
    const sent = JSON.stringify(scrubEvent(realisticEvent()));
    for (const value of PERSONAL) expect(sent).not.toContain(value);
    expect(sent).not.toContain('41.250.1.2');
    expect(sent).not.toContain('abc123secret');
  });

  it('garde ce qui sert au diagnostic', () => {
    const event = scrubEvent(realisticEvent());
    expect(event.request).toEqual({
      method: 'POST',
      url: '/api/v1/public/quotes/[jeton]/accept',
      headers: { 'content-type': 'application/json' },
    });
    expect(event.exception?.values?.[0]).toMatchObject({
      type: 'Error',
      value: 'Client [téléphone] introuvable',
      stacktrace: { frames: [{ filename: '/app/dist/sms.js', function: 'send' }] },
    });
    expect(event.user).toBeUndefined();
    expect(event.extra).toMatchObject({ client: { lastName: REDACTED, city: 'Casablanca' } });
    expect(event.contexts).toMatchObject({
      order: { reference: 'CMD-2026-00012', clientName: REDACTED },
      runtime: { name: 'node' },
    });
    expect(event.sdk).toEqual({ name: 'sentry.javascript.node', version: '11.7.0' });
  });

  it('fil d’Ariane : URL et données masquées, corps jamais conservé', () => {
    const crumb = scrubBreadcrumb({
      message: 'GET /devis/k3Q9x_TzP8mLwR2vN5bY7cJ1hF4dG6sA0eU-iOpQrSt',
      data: {
        url: 'https://x.ma/?password=secret1',
        body: '{"phone":"0612345678"}',
        status_code: 500,
      },
    });
    expect(JSON.stringify(crumb)).not.toMatch(/k3Q9x|secret1|0612345678/);
    expect(crumb.data).toMatchObject({ status_code: 500 });
  });

  it('textes : e-mails, téléphones marocains et internationaux, jetons', () => {
    expect(scrubText('Appel 0712345678 ou +33 6 12 34 56 78, a.b@c.ma')).toBe(
      'Appel [téléphone] ou [téléphone], [e-mail]',
    );
    expect(scrubText('Montant 1500,00 MAD, commande CMD-2026-00012')).toBe(
      'Montant 1500,00 MAD, commande CMD-2026-00012',
    );
  });

  it('span : URL et requêtes masquées, identifiants techniques conservés', () => {
    const span = scrubSpan({
      span_id: 'a1b2c3d4e5f60718',
      name: 'GET /devis/k3Q9x_TzP8mLwR2vN5bY7cJ1hF4dG6sA0eU-iOpQrSt',
      attributes: {
        'url.full': 'https://app.exemple.ma/api?token=abc123secret',
        'db.system': 'postgresql',
      },
    });
    expect(span).toEqual({
      span_id: 'a1b2c3d4e5f60718',
      name: 'GET /devis/[jeton]',
      attributes: {
        'url.full': 'https://app.exemple.ma/api?token=[masqué]',
        'db.system': 'postgresql',
      },
    });
  });
});
