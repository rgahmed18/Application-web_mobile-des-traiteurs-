import { describe, expect, it } from 'vitest';

import { whatsappUrl } from './whatsapp-button';

describe('whatsappUrl', () => {
  it('numéro sans « + » et message prérempli encodé (arabe compris)', () => {
    expect(whatsappUrl('+212661234567', 'Bonjour, je souhaite un devis pour…')).toBe(
      'https://wa.me/212661234567?text=Bonjour%2C%20je%20souhaite%20un%20devis%20pour%E2%80%A6',
    );
    expect(whatsappUrl('+212661234567', 'السلام عليكم')).toMatch(
      /^https:\/\/wa\.me\/212661234567\?text=%D8%A7/,
    );
  });
});
