import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { appErrors } from '../errors';
import { Prisma } from '../../generated/prisma/client';

/**
 * Verrouillage optimiste (voir @traiteur/shared, editing/edit-version) : version de l'élément
 * chargé par le client, lue dans l'en-tête « If-Match » (guillemets et préfixe W/ acceptés).
 * Absente : pas de vérification (clients plus anciens, scripts).
 */
export const ExpectedVersion = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const header = context.switchToHttp().getRequest<Request>().headers['if-match'];
    if (typeof header !== 'string') return null;
    const value = header
      .trim()
      .replace(/^W\//, '')
      .replace(/^"(.*)"$/, '$1')
      .slice(0, 100);
    return value === '' || value === '*' ? null : value;
  },
);

/** Refus si l'élément a changé depuis sa lecture par le client (jamais d'écrasement). */
export function assertEditVersion(current: string, expected: string | null): void {
  if (expected === null || expected === current) return;
  throw appErrors.conflict(
    'EDIT_CONFLICT',
    'Modifié entre-temps par quelqu’un d’autre : rechargez pour voir la version actuelle.',
  );
}

/** Tables dont la version est la date de dernière modification. */
type VersionedTable = 'Dish' | 'Package' | 'ExtraService' | 'Buffet' | 'EquipmentItem';

/**
 * Verrouille la ligne jusqu'à la fin de la transaction (deux enregistrements simultanés ne
 * passent pas tous deux la vérification), puis compare sa date de modification à la version
 * présentée. Ligne absente : rien (le service répond « introuvable »).
 */
export async function lockEditVersion(
  tx: Prisma.TransactionClient,
  table: VersionedTable,
  traiteurId: string,
  id: string,
  expected: string | null,
): Promise<void> {
  const rows = await tx.$queryRaw<{ updatedAt: Date }[]>(Prisma.sql`
    SELECT "updatedAt" FROM ${Prisma.raw(`"${table}"`)}
    WHERE "id" = ${id}::uuid AND "traiteurId" = ${traiteurId}::uuid
    FOR UPDATE`);
  const row = rows[0];
  if (!row) return;
  if (expected !== null && Number.isNaN(Date.parse(expected))) assertEditVersion('', expected);
  assertEditVersion(
    row.updatedAt.toISOString(),
    expected === null ? null : new Date(expected).toISOString(),
  );
}

/**
 * Verrouille une ligne jusqu'à la fin de la transaction, avant d'en lire la version (empreinte
 * du contenu : paramètres sur la ligne du traiteur, fiche client sur son Membership).
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: 'Traiteur' | 'Membership',
  id: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id}::uuid FOR UPDATE`,
  );
}
