import { describe, expect, it } from 'vitest';

import { draftFormKeySchema, stripSensitiveFields } from './draft.schemas';

describe('stripSensitiveFields : jamais de champ sensible dans un brouillon', () => {
  it('retire mots de passe, codes de double authentification, de secours et SMS, à toute profondeur', () => {
    const values = {
      name: 'Couscous royal',
      password: 'Secret2026',
      newPassword: 'x',
      currentPassword: 'y',
      code: '123456',
      otp: '654321',
      recoveryCode: 'ABCD-EFGH',
      twoFactorCode: '111111',
      challengeToken: 'abc',
      account: { password: 'z', firstName: 'Karim', nested: [{ code: '1', label: 'ok' }] },
      lines: [{ label: 'Menu', quantity: 120 }],
    };
    expect(stripSensitiveFields(values)).toEqual({
      name: 'Couscous royal',
      account: { firstName: 'Karim', nested: [{ label: 'ok' }] },
      lines: [{ label: 'Menu', quantity: 120 }],
    });
  });

  it('valeurs simples inchangées', () => {
    expect(stripSensitiveFields(null)).toBeNull();
    expect(stripSensitiveFields('texte')).toBe('texte');
    expect(stripSensitiveFields([1, 2])).toEqual([1, 2]);
  });
});

describe('draftFormKeySchema', () => {
  it('formulaires connus seulement', () => {
    for (const key of [
      'order:new',
      'dish:7d7c5f1e-1c2a-4b8a-9d0e-123456789abc',
      'settings:company',
      'settings:availability',
    ]) {
      expect(draftFormKeySchema.safeParse(key).success).toBe(true);
    }
    for (const key of ['account:new', 'order:abc', 'settings:account', '../x', 'order:new:x']) {
      expect(draftFormKeySchema.safeParse(key).success).toBe(false);
    }
  });
});
