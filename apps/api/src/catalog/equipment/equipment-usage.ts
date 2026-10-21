import {
  EQUIPMENT_FIRM_STATUSES,
  EQUIPMENT_PENDING_STATUSES,
  type OccupationPeriod,
  occupationPeriod,
  periodsOverlap,
} from '@traiteur/shared';

import type { Prisma } from '../../generated/prisma/client';

type Db = Prisma.TransactionClient;

/** Délais du traiteur, appliqués aux commandes qui n'ont pas les leurs. */
export interface EquipmentDelays {
  equipmentSetupHours: number;
  equipmentReturnHours: number;
}

/** Quantités occupées par article sur une période : commandes fermes et commandes en attente. */
export interface EquipmentUsage {
  reserved: Map<string, number>;
  pending: Map<string, number>;
}

/** Une marge de 10 jours couvre les délais (240 h au plus) pour présélectionner les commandes. */
const CANDIDATE_MARGIN_MS = 10 * 86_400_000;

/**
 * Matériel occupé par les autres commandes sur la période : une commande occupe son matériel de
 * son début moins le délai d'installation à sa fin plus le délai de retour. Seules les commandes
 * fermes sont déduites du stock ; les commandes en attente sont comptées à part (indicatif).
 */
export async function equipmentUsage(
  db: Db,
  traiteurId: string,
  period: OccupationPeriod,
  delays: EquipmentDelays,
  options: { excludeOrderId?: string; equipmentIds?: readonly string[] } = {},
): Promise<EquipmentUsage> {
  const lines = await db.orderItem.findMany({
    where: {
      traiteurId,
      equipmentId: options.equipmentIds ? { in: [...options.equipmentIds] } : { not: null },
      order: {
        status: { in: [...EQUIPMENT_FIRM_STATUSES, ...EQUIPMENT_PENDING_STATUSES] },
        eventDate: {
          gte: new Date(period.start.getTime() - CANDIDATE_MARGIN_MS),
          lte: new Date(period.end.getTime() + CANDIDATE_MARGIN_MS),
        },
        ...(options.excludeOrderId ? { id: { not: options.excludeOrderId } } : {}),
      },
    },
    select: {
      equipmentId: true,
      quantity: true,
      order: {
        select: {
          status: true,
          eventDate: true,
          eventEndDate: true,
          equipmentSetupHours: true,
          equipmentReturnHours: true,
        },
      },
    },
  });

  const usage: EquipmentUsage = { reserved: new Map(), pending: new Map() };
  const firm = new Set<string>(EQUIPMENT_FIRM_STATUSES);
  for (const line of lines) {
    if (!line.equipmentId) continue;
    const occupied = occupationPeriod(
      line.order.eventDate,
      line.order.eventEndDate,
      line.order.equipmentSetupHours ?? delays.equipmentSetupHours,
      line.order.equipmentReturnHours ?? delays.equipmentReturnHours,
    );
    if (!periodsOverlap(occupied, period)) continue;
    const target = firm.has(line.order.status) ? usage.reserved : usage.pending;
    target.set(line.equipmentId, (target.get(line.equipmentId) ?? 0) + line.quantity);
  }
  return usage;
}
