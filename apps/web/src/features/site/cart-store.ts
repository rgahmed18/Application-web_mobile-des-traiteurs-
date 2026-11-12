'use client';

import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import { CART_KINDS, type CartKind, perGuest } from './cart-kinds';

/**
 * « Ma demande » : sélection du visiteur dans le catalogue, gardée dans le navigateur (par
 * traiteur) jusqu'à l'envoi. Elle ne contient QUE des références du catalogue et des quantités,
 * jamais de donnée personnelle ; elle est vidée à la déconnexion.
 */
export { CART_KINDS, type CartKind, perGuest } from './cart-kinds';

const cartItemSchema = z.object({
  kind: z.enum(CART_KINDS),
  id: z.uuid(),
  /** Matériel et services : quantité ; menus et buffets : nombre d'invités de la demande. */
  quantity: z.number().int().min(1).max(10_000),
});
export type CartItem = z.infer<typeof cartItemSchema>;
const cartSchema = z.array(cartItemSchema).max(50);

const EMPTY: CartItem[] = [];
const listeners = new Set<() => void>();
let slug: string | null = null;
let items: CartItem[] = EMPTY;

const storageKey = (traiteur: string) => `gt-demande:${traiteur}`;

function read(traiteur: string): CartItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(traiteur));
    const parsed = cartSchema.safeParse(raw ? JSON.parse(raw) : []);
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(next: CartItem[]): void {
  items = next;
  if (slug) {
    try {
      if (next.length === 0) window.localStorage.removeItem(storageKey(slug));
      else window.localStorage.setItem(storageKey(slug), JSON.stringify(next));
    } catch {
      // Stockage indisponible (navigation privée…) : la sélection reste en mémoire
    }
  }
  for (const listener of listeners) listener();
}

export const cartStore = {
  /** Site d'un traiteur : relit sa sélection (et suit les autres onglets). */
  open(traiteur: string): void {
    if (slug === traiteur) return;
    slug = traiteur;
    items = read(traiteur);
    window.addEventListener('storage', (event) => {
      if (slug && event.key === storageKey(slug)) {
        items = read(slug);
        for (const listener of listeners) listener();
      }
    });
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): CartItem[] => items,
  serverSnapshot: (): CartItem[] => EMPTY,

  add(kind: CartKind, id: string, quantity = 1): void {
    const existing = items.find((item) => item.kind === kind && item.id === id);
    if (existing) {
      // Matériel ou service déjà choisi : la quantité s'ajoute ; menu ou buffet : inchangé
      if (perGuest(kind)) return;
      cartStore.setQuantity(kind, id, existing.quantity + quantity);
      return;
    }
    write([...items, { kind, id, quantity }]);
  },
  setQuantity(kind: CartKind, id: string, quantity: number): void {
    const bounded = Math.max(1, Math.min(10_000, Math.round(quantity)));
    write(
      items.map((item) =>
        item.kind === kind && item.id === id ? { ...item, quantity: bounded } : item,
      ),
    );
  },
  remove(kind: CartKind, id: string): void {
    write(items.filter((item) => !(item.kind === kind && item.id === id)));
  },
  clear(): void {
    write(EMPTY);
  },
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(cartStore.subscribe, cartStore.snapshot, cartStore.serverSnapshot);
}
