import { describe, expect, it } from 'vitest';

import { orderAlternatives } from './order-alternatives';

const menu = (totalTtc: number) => ({ itemType: 'PACKAGE', totalTtc });

describe('demande en ligne : le client hésite entre plusieurs gammes', () => {
  it('trois formules et du matériel : fourchette, jamais la somme des formules', () => {
    const lines = [menu(4_200_000), menu(5_400_000), menu(6_750_000)];
    const equipment = { itemType: 'EQUIPMENT', totalTtc: 225_000 };
    const result = orderAlternatives({
      source: 'ONLINE',
      totalTtc: 16_350_000 + 225_000,
      lines: [...lines, equipment],
    });
    expect(result).toEqual({
      count: 3,
      range: { min: 4_200_000 + 225_000, max: 6_750_000 + 225_000 },
    });
  });

  it('une seule formule, ou commande saisie au back-office : total habituel', () => {
    expect(
      orderAlternatives({ source: 'ONLINE', totalTtc: 4_200_000, lines: [menu(4_200_000)] }),
    ).toBeNull();
    expect(
      orderAlternatives({
        source: 'BACKOFFICE',
        totalTtc: 9_600_000,
        lines: [menu(4_200_000), menu(5_400_000)],
      }),
    ).toBeNull();
  });
});
