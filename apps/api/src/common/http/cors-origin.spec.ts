import { isAllowedOrigin } from './cors-origin';

describe('isAllowedOrigin', () => {
  const allowed = ['http://localhost:3001', 'http://*.192.168.1.8.nip.io:3001'];

  it('origine exacte', () => {
    expect(isAllowedOrigin('http://localhost:3001', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3002', allowed)).toBe(false);
  });

  it('sous-domaine d’un traiteur : un seul niveau, même schéma et même port', () => {
    expect(isAllowedOrigin('http://dar-diafa.192.168.1.8.nip.io:3001', allowed)).toBe(true);
    expect(isAllowedOrigin('http://a.b.192.168.1.8.nip.io:3001', allowed)).toBe(false);
    expect(isAllowedOrigin('https://dar-diafa.192.168.1.8.nip.io:3001', allowed)).toBe(false);
    expect(isAllowedOrigin('http://dar-diafa.192.168.1.8.nip.io:3002', allowed)).toBe(false);
    expect(isAllowedOrigin('http://evil.com/.192.168.1.8.nip.io:3001', allowed)).toBe(false);
    expect(isAllowedOrigin('http://192.168.1.8.nip.io:3001', allowed)).toBe(false);
  });
});
