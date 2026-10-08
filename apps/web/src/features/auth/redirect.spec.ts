import { describe, expect, it } from 'vitest';

import { safeNextPath } from './redirect';

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
