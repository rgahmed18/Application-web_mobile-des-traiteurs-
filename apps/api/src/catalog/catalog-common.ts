import {
  type CatalogSettings,
  numberedSlug,
  parseLocalizedText,
  type LocalizedText,
  type PriceMode,
  slugify,
  type TaxSettings,
} from '@traiteur/shared';

import { appErrors } from '../common/errors';
import { Prisma } from '../generated/prisma/client';

type Db = Prisma.TransactionClient;

export { requireTraiteurId } from '../common/tenant';

export interface PricingSettings extends TaxSettings {
  priceEntryMode: PriceMode;
}

export async function loadCatalogSettings(db: Db, traiteurId: string): Promise<CatalogSettings> {
  const traiteur = await db.traiteur.findUniqueOrThrow({
    where: { id: traiteurId },
    select: {
      priceEntryMode: true,
      isVatRegistered: true,
      defaultTaxRateBps: true,
      currency: true,
      timezone: true,
    },
  });
  return traiteur;
}

/**
 * Identifiant d'URL unique chez le traiteur, construit à partir du nom français
 * (« pastilla », puis « pastilla-2 », « pastilla-3 »...).
 */
export async function uniqueSlug(
  name: LocalizedText,
  fallback: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name.fr, fallback);
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = numberedSlug(base, attempt);
    if (!(await isTaken(candidate))) return candidate;
  }
  return numberedSlug(base, Date.now());
}

/** Conflit d'unicité (slug pris entre la vérification et l'écriture). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Violation de clé étrangère (élément référencé par une commande, un devis, une formule). */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

export function toLocalized(value: Prisma.JsonValue): LocalizedText {
  return parseLocalizedText(value);
}

export function toLocalizedOrNull(value: Prisma.JsonValue | null): LocalizedText | null {
  return value === null ? null : parseLocalizedText(value);
}

export function toIso(date: Date): string;
export function toIso(date: Date | null): string | null;
export function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** Valeur JSON pour le journal d'audit (instantané sérialisable de l'élément). */
export function auditSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Description facultative : null en base (Prisma.DbNull pour une colonne JSON). */
export function jsonOrDbNull(
  value: LocalizedText | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

export function notFound(): never {
  throw appErrors.notFound('NOT_FOUND', 'Élément introuvable');
}
