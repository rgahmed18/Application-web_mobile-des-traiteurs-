import { describe, expect, it } from 'vitest';

import { formatDocumentReference } from './documents';

describe('formatDocumentReference', () => {
  it('formate les références par type', () => {
    expect(formatDocumentReference('ORDER', 2026, 1)).toBe('CMD-2026-00001');
    expect(formatDocumentReference('QUOTE', 2026, 42)).toBe('DEV-2026-00042');
    expect(formatDocumentReference('INVOICE', 2026, 12345)).toBe('FAC-2026-12345');
    expect(formatDocumentReference('CREDIT_NOTE', 2027, 3)).toBe('AV-2027-00003');
  });

  it('ne tronque pas au-delà de 5 chiffres', () => {
    expect(formatDocumentReference('INVOICE', 2026, 123456)).toBe('FAC-2026-123456');
  });

  it('refuse un numéro nul ou négatif', () => {
    expect(() => formatDocumentReference('INVOICE', 2026, 0)).toThrow(RangeError);
  });
});
