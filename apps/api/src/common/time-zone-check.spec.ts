import { assertTimeZoneData } from './time-zone-check';

describe('base des fuseaux horaires', () => {
  it('à jour : démarrage normal', () => {
    expect(() => assertTimeZoneData(true, 'production')).not.toThrow();
  });

  it('obsolète : refus de démarrer en production, simple avertissement sinon', () => {
    expect(() => assertTimeZoneData(false, 'production')).toThrow(/fuseaux horaires obsolète/);
    expect(() => assertTimeZoneData(false, 'development')).not.toThrow();
  });
});
