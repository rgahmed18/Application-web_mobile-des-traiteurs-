import { normalizeIpAddress } from './ip-address';

describe('normalizeIpAddress', () => {
  it('ramène une IPv4 encapsulée en IPv6 à sa forme courte', () => {
    expect(normalizeIpAddress('::ffff:192.168.43.120')).toBe('192.168.43.120');
    expect(normalizeIpAddress('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  it('garde les autres adresses telles quelles', () => {
    expect(normalizeIpAddress('192.168.43.120')).toBe('192.168.43.120');
    expect(normalizeIpAddress('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIpAddress('::1')).toBe('::1');
    expect(normalizeIpAddress(null)).toBeNull();
    expect(normalizeIpAddress('')).toBeNull();
  });
});
