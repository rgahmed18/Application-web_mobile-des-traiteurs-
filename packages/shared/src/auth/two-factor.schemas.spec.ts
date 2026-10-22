import { describe, expect, it } from 'vitest';

import { isTwoFactorChallenge, twoFactorCodeSchema } from './two-factor.schemas';

describe('codes de double authentification', () => {
  it('code de l’application ou code de secours, espaces et casse tolérés', () => {
    expect(twoFactorCodeSchema.parse(' 123 456 ')).toBe('123456');
    expect(twoFactorCodeSchema.parse('abcd-efgh')).toBe('ABCD-EFGH');
    expect(twoFactorCodeSchema.parse('abcd efgh')).toBe('ABCDEFGH');
    expect(twoFactorCodeSchema.safeParse('12345').success).toBe(false);
    expect(twoFactorCodeSchema.safeParse('ABCD-EFGH-IJ').success).toBe(false);
  });

  it('distingue une deuxième étape d’une session', () => {
    expect(
      isTwoFactorChallenge({ twoFactor: 'SETUP', challengeToken: 'x'.repeat(43), expiresIn: 600 }),
    ).toBe(true);
  });
});
