import { type EstimateRange, totalRange } from '@/features/site/cart-estimate';

interface AlternativeLine {
  itemType: string;
  totalTtc: number;
}

/**
 * Demande en ligne avec plusieurs formules : le client hésite entre des gammes pour son
 * événement (une commande = un événement) et n'en prendra qu'une. Total TTC présenté en
 * fourchette (formule la moins chère → la plus chère, plus le reste), jamais leur somme.
 * Null : une seule formule (ou commande du back-office), total habituel.
 */
export function orderAlternatives(order: {
  source: string;
  totalTtc: number;
  lines: AlternativeLine[];
}): { count: number; range: EstimateRange } | null {
  if (order.source !== 'ONLINE') return null;
  const menus = order.lines.filter((line) => line.itemType === 'PACKAGE');
  if (menus.length < 2) return null;
  const menusTotal = menus.reduce((total, line) => total + line.totalTtc, 0);
  return {
    count: menus.length,
    range: totalRange([order.totalTtc - menusTotal], [menus.map((line) => line.totalTtc)]),
  };
}
