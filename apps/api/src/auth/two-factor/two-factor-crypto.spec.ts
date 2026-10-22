import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCodeShape } from './recovery-codes';
import { openSecret, sealSecret } from './secret-box';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp';

// Vecteurs de la RFC 6238 (SHA-1, clé « 12345678901234567890 »), 6 derniers chiffres
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const at = (seconds: number) => new Date(seconds * 1000);

describe('TOTP (RFC 6238)', () => {
  it('base32 aller-retour et clé de la RFC', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('codes des vecteurs de test', () => {
    expect(totpCode(RFC_SECRET, totpStep(at(59)))).toBe('287082');
    expect(totpCode(RFC_SECRET, totpStep(at(1_111_111_109)))).toBe('081804');
    expect(totpCode(RFC_SECRET, totpStep(at(1_234_567_890)))).toBe('005924');
    expect(totpCode(RFC_SECRET, totpStep(at(2_000_000_000)))).toBe('279037');
  });

  it('tolère un pas de décalage, refuse au-delà et refuse un code déjà utilisé', () => {
    const now = at(1_234_567_890);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, null)).toBeNull();
    // Rejeu : le code du pas déjà accepté (ou d'un pas antérieur) est refusé
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
  });

  it('lien otpauth pour le QR code', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', '+212600000001', 'Gestion Traiteurs');
    expect(uri).toBe(
      'otpauth://totp/Gestion%20Traiteurs%3A%2B212600000001?secret=JBSWY3DPEHPK3PXP&issuer=Gestion+Traiteurs&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secrets chiffrés et codes de secours', () => {
  it('chiffrement authentifié : relu avec la bonne clé, refusé sinon', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', 'a'.repeat(32));
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, 'a'.repeat(32))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openSecret(sealed, 'b'.repeat(32))).toThrow();
    // Deux chiffrements du même secret diffèrent (vecteur aléatoire)
    expect(sealSecret('JBSWY3DPEHPK3PXP', 'a'.repeat(32))).not.toBe(sealed);
  });

  it('dix codes distincts, lisibles, comparés sans tenir compte du format', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const [first = ''] = codes;
    expect(hashRecoveryCode(first.toLowerCase().replace('-', ' '))).toBe(hashRecoveryCode(first));
    expect(isRecoveryCodeShape('abcd-efgh')).toBe(true);
    expect(isRecoveryCodeShape('123456')).toBe(false);
  });
});
