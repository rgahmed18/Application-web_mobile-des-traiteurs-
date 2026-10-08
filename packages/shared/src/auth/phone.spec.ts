import { describe, expect, it } from 'vitest';

import { maskPhone, normalizePhone, phoneSchema } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['0612345678', '+212612345678'],
    ['06 12 34 56 78', '+212612345678'],
    ['06-12-34-56-78', '+212612345678'],
    ['+212612345678', '+212612345678'],
    ['+212 6 12 34 56 78', '+212612345678'],
    ['00212612345678', '+212612345678'],
    ['212712345678', '+212712345678'],
    ['+2120612345678', '+212612345678'],
    ['0522123456', '+212522123456'],
    ['+33612345678', '+33612345678'],
  ])('normalise %s en %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', '0812345678', '+2128123456789', '061234567', 'abc'])(
    'refuse %s',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('phoneSchema', () => {
  it('retourne le numéro normalisé', () => {
    expect(phoneSchema.parse(' 0612345678 ')).toBe('+212612345678');
  });

  it('produit une erreur lisible', () => {
    const result = phoneSchema.safeParse('123');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Numéro de téléphone invalide');
  });
});

describe('maskPhone', () => {
  it('masque le milieu du numéro', () => {
    expect(maskPhone('+212612345678')).toBe('+2126****5678');
  });
});
