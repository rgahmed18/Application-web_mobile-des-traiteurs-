import { describe, expect, it } from 'vitest';

import { mailtoUrl, shareMessage, smsUrl, whatsappUrl } from './share-links';

const input = {
  firstName: 'Salma',
  reference: 'DEV-2026-00012',
  url: 'https://exemple.ma/devis/abc_DEF-123',
  validUntil: '24/10/2026',
};

describe('liens de partage du devis', () => {
  it('message en français et en arabe, avec le lien', () => {
    expect(shareMessage({ ...input, locale: 'fr' })).toBe(
      'Bonjour Salma, voici votre devis DEV-2026-00012 : https://exemple.ma/devis/abc_DEF-123 (valable jusqu’au 24/10/2026).',
    );
    const ar = shareMessage({ ...input, locale: 'ar' });
    expect(ar).toContain('عرض السعر DEV-2026-00012');
    expect(ar).toContain(input.url);
  });

  it('WhatsApp : numéro en chiffres seuls, texte encodé', () => {
    expect(whatsappUrl('+212 661-23 45 67', 'a & b')).toBe(
      'https://wa.me/212661234567?text=a%20%26%20b',
    );
  });

  it('SMS et e-mail', () => {
    expect(smsUrl('+212661234567', 'Bonjour ?')).toBe('sms:+212661234567?body=Bonjour%20%3F');
    expect(mailtoUrl('Votre devis', 'x=1')).toBe('mailto:?subject=Votre%20devis&body=x%3D1');
  });
});
