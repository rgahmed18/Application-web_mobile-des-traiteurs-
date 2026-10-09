import { type LineLabel, lineLabelSchema } from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';

/**
 * Libellé d'une ligne lu en base (colonne JSONB `label`). La base garantit un objet avec un
 * libellé français (contrainte CHECK) ; une traduction trop longue ou inattendue est ignorée.
 */
export function readLineLabel(value: Prisma.JsonValue): LineLabel {
  const parsed = lineLabelSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  const pick = (key: 'fr' | 'ar' | 'en') => {
    const text = record[key];
    return typeof text === 'string' && text.trim() !== '' ? text : undefined;
  };
  const ar = pick('ar');
  const en = pick('en');
  return { fr: pick('fr') ?? '', ...(ar ? { ar } : {}), ...(en ? { en } : {}) };
}
