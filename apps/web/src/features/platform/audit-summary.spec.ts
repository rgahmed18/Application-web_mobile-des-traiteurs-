import { describe, expect, it } from 'vitest';

import { requestSection } from './audit-summary';

describe('requestSection : rubrique lisible d’une requête de la plateforme', () => {
  it('sans identifiants ni préfixe de version', () => {
    expect(requestSection('/api/v1/settings/company')).toBe('settings');
    expect(requestSection('/api/v1/settings/billing')).toBe('settings_billing');
    expect(
      requestSection('/api/v1/catalog/dishes/7d7c5f1e-1c2a-4b8a-9d0e-123456789abc/archive'),
    ).toBe('catalog_dishes');
    expect(requestSection('/api/v1/orders/7d7c5f1e-1c2a-4b8a-9d0e-123456789abc/payments')).toBe(
      'orders',
    );
    expect(requestSection('/api/v1/cash-desk/remit')).toBe('cash_desk');
    expect(requestSection('/api/v1/me/two-factor/disable')).toBe('me_two_factor');
  });

  it('chemin inconnu : rubrique générique, jamais le chemin technique', () => {
    expect(requestSection('/api/v1/inconnu/x')).toBe('other');
    expect(requestSection('')).toBe('other');
  });
});
