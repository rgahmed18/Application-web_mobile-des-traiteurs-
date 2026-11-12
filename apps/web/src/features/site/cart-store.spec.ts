import { beforeAll, describe, expect, it } from 'vitest';

/** Stockage du navigateur simulé (environnement Node des tests). */
const storage = new Map<string, string>();
beforeAll(() => {
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: () => undefined,
    },
  });
});

const MENU = '11111111-1111-4111-8111-111111111111';
const CHAIRS = '22222222-2222-4222-8222-222222222222';

describe('« Ma demande » gardée dans le navigateur', () => {
  it('ne garde que des références du catalogue et des quantités, par traiteur', async () => {
    const { cartStore } = await import('./cart-store');
    cartStore.open('dar-diafa');
    cartStore.add('menu', MENU);
    cartStore.add('menu', MENU); // un menu n'est ajouté qu'une fois
    cartStore.add('equipment', CHAIRS, 50);
    cartStore.add('equipment', CHAIRS, 10); // le matériel s'additionne
    expect(cartStore.snapshot()).toEqual([
      { kind: 'menu', id: MENU, quantity: 1 },
      { kind: 'equipment', id: CHAIRS, quantity: 60 },
    ]);
    const stored: unknown = JSON.parse(storage.get('gt-demande:dar-diafa') ?? '[]');
    for (const item of stored as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(['id', 'kind', 'quantity']);
    }
  });

  it('borne les quantités, ignore un contenu modifié à la main, se vide entièrement', async () => {
    const { cartStore } = await import('./cart-store');
    cartStore.setQuantity('equipment', CHAIRS, -5);
    expect(cartStore.snapshot().find((item) => item.id === CHAIRS)?.quantity).toBe(1);

    storage.set('gt-demande:autre', JSON.stringify([{ kind: 'menu', id: 'pas-un-id', name: 'X' }]));
    cartStore.open('autre');
    expect(cartStore.snapshot()).toEqual([]);

    cartStore.open('dar-diafa');
    cartStore.clear();
    expect(cartStore.snapshot()).toEqual([]);
    expect(storage.has('gt-demande:dar-diafa')).toBe(false);
  });
});
