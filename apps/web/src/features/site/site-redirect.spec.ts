import { describe, expect, it } from 'vitest';

import { siteLoginHref, siteNextPath } from './site-redirect';

describe('siteNextPath : retour après connexion, limité au site du traiteur', () => {
  it.each([
    ['/demande', '/demande'],
    ['/espace/devis', '/espace/devis'],
    ['/catalogue?gamme=PREMIUM', '/catalogue?gamme=PREMIUM'],
    ['/', '/'],
  ])('garde %s', (next, expected) => {
    expect(siteNextPath(next)).toBe(expected);
  });

  it.each([
    null,
    '',
    '//pirate.example',
    'https://pirate.example',
    '/admin/orders',
    '/platform',
    '/\\pirate.example',
    '/api/client-session/logout',
  ])('refuse %s : espace du client', (next) => {
    expect(siteNextPath(next)).toBe('/espace');
  });

  it('encode la page de retour', () => {
    expect(siteLoginHref('/demande?etape=2')).toBe('/connexion?suite=%2Fdemande%3Fetape%3D2');
  });
});
