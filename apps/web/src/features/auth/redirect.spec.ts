import { describe, expect, it } from 'vitest';

import { destinationFor, safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it('accepte une page du back-office', () => {
    expect(safeNextPath('/admin/catalog/dishes?page=2')).toBe('/admin/catalog/dishes?page=2');
  });

  it.each([
    null,
    '',
    'https://pirate.example',
    '//pirate.example',
    '/autre',
    '/admin\\@pirate',
    '/admin/login',
  ])('renvoie au tableau de bord pour « %s »', (next) => {
    expect(safeNextPath(next)).toBe('/admin');
  });
});

describe('destinationFor (console de la plateforme)', () => {
  it('le super admin arrive toujours sur la console, jamais dans un back-office', () => {
    expect(destinationFor('/admin', true)).toBe('/platform');
    expect(destinationFor('/admin/orders', true)).toBe('/platform');
    expect(destinationFor('/platform/traiteurs', true)).toBe('/platform/traiteurs');
  });

  it('les autres comptes n’arrivent jamais sur la console', () => {
    expect(destinationFor('/platform', false)).toBe('/admin');
    expect(destinationFor('/admin/catalog', false)).toBe('/admin/catalog');
    expect(safeNextPath('/platform/audit')).toBe('/platform/audit');
  });
});
