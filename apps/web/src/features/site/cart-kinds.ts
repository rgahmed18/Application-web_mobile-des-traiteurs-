/**
 * Types d'éléments de « ma demande » (et des fiches du catalogue : /catalogue/<type>/<id>).
 * Module neutre, lisible par les pages serveur comme par le navigateur.
 */
export const CART_KINDS = ['menu', 'buffet', 'equipment', 'service'] as const;
export type CartKind = (typeof CART_KINDS)[number];

/** Menus et buffets : pour tous les invités ; matériel et services : à la quantité. */
export const perGuest = (kind: CartKind) => kind === 'menu' || kind === 'buffet';
