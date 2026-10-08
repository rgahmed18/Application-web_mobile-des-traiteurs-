import { formatDocumentReference } from '@traiteur/shared';

import type { DocumentType, Prisma } from '../generated/prisma/client';

export interface NextDocumentNumber {
  reference: string;
  year: number;
  value: number;
}

/** Année civile d'une date dans le fuseau du traiteur (le 31/12 à 23h30 à Casablanca reste 31/12). */
export function getYearInTimeZone(date: Date, timeZone: string): number {
  const year = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date);
  return Number(year);
}

/**
 * Réserve le prochain numéro d'un document (commande, devis, facture, avoir).
 *
 * Garanties :
 * - Atomique : `INSERT … ON CONFLICT DO UPDATE` verrouille la ligne du compteur jusqu'à la fin
 *   de la transaction ; deux transactions simultanées obtiennent des numéros différents.
 * - Sans trou : DOIT être appelée dans la même transaction que la création du document.
 *   Si la transaction échoue, l'incrément est annulé avec elle.
 *
 * Le paramètre est volontairement un client de transaction (Prisma.TransactionClient).
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  params: { traiteurId: string; type: DocumentType; date?: Date; timeZone?: string },
): Promise<NextDocumentNumber> {
  const timeZone =
    params.timeZone ??
    (
      await tx.traiteur.findUniqueOrThrow({
        where: { id: params.traiteurId },
        select: { timezone: true },
      })
    ).timezone;
  const year = getYearInTimeZone(params.date ?? new Date(), timeZone);

  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "DocumentSequence" ("id", "traiteurId", "type", "year", "lastValue", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${params.traiteurId}::uuid, ${params.type}::"DocumentType", ${year}, 1, now(), now())
    ON CONFLICT ("traiteurId", "type", "year")
    DO UPDATE SET "lastValue" = "DocumentSequence"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;

  const value = rows[0]?.lastValue;
  if (value === undefined) throw new Error('Numérotation impossible : aucune valeur retournée');
  return { reference: formatDocumentReference(params.type, year, value), year, value };
}
