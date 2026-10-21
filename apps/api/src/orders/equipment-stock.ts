import { type EquipmentShortage, occupationPeriod } from '@traiteur/shared';

import { toLocalized } from '../catalog/catalog-common';
import { type EquipmentDelays, equipmentUsage } from '../catalog/equipment/equipment-usage';
import type { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

/** Commande dont on vérifie le matériel (dates et délais tels qu'ils seront enregistrés). */
export interface StockOrder {
  id: string | null;
  eventDate: Date;
  eventEndDate: Date | null;
  equipmentSetupHours: number | null;
  equipmentReturnHours: number | null;
}

/**
 * Matériel en manque pour une commande qui devient (ou reste) ferme : quantités demandées par
 * article, comparées au stock moins les commandes fermes dont l'occupation chevauche la sienne.
 * Les confirmations concurrentes d'un même article sont sérialisées (verrou par article, dans
 * l'ordre des identifiants pour éviter les interblocages).
 */
export async function equipmentShortages(
  tx: Db,
  traiteurId: string,
  order: StockOrder,
  lines: readonly { equipmentId: string | null; quantity: number }[],
  delays: EquipmentDelays,
): Promise<EquipmentShortage[]> {
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (!line.equipmentId) continue;
    requested.set(line.equipmentId, (requested.get(line.equipmentId) ?? 0) + line.quantity);
  }
  if (requested.size === 0) return [];

  const ids = [...requested.keys()].sort();
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`equipment:${traiteurId}:${id}`}))`;
  }
  const period = occupationPeriod(
    order.eventDate,
    order.eventEndDate,
    order.equipmentSetupHours ?? delays.equipmentSetupHours,
    order.equipmentReturnHours ?? delays.equipmentReturnHours,
  );
  const [items, usage] = await Promise.all([
    tx.equipmentItem.findMany({
      where: { traiteurId, id: { in: ids } },
      select: { id: true, name: true, stockQuantity: true },
    }),
    equipmentUsage(tx, traiteurId, period, delays, {
      excludeOrderId: order.id ?? undefined,
      equipmentIds: ids,
    }),
  ]);

  const shortages: EquipmentShortage[] = [];
  for (const item of items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))) {
    const wanted = requested.get(item.id) ?? 0;
    const reserved = usage.reserved.get(item.id) ?? 0;
    const remaining = item.stockQuantity - reserved;
    if (wanted <= remaining) continue;
    shortages.push({
      equipmentId: item.id,
      label: toLocalized(item.name),
      requested: wanted,
      stock: item.stockQuantity,
      reserved,
      pending: usage.pending.get(item.id) ?? 0,
      remaining,
    });
  }
  return shortages;
}
