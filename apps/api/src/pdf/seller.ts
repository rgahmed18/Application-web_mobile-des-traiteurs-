import { localizedTextSchema } from '@traiteur/shared';

import type { Prisma } from '../generated/prisma/client';
import { auto, ltr } from './document-model';
import { type DocLocale, formatAmount } from './format';
import { docLabels } from './labels';

/** Champs du traiteur imprimés sur les documents (copie figée dans les factures). */
export const sellerSelect = {
  name: true,
  email: true,
  phone: true,
  city: true,
  legalName: true,
  legalForm: true,
  shareCapital: true,
  ice: true,
  rcNumber: true,
  rcCourt: true,
  taxId: true,
  patenteNumber: true,
  cnssNumber: true,
  legalAddress: true,
  bankName: true,
  rib: true,
  invoiceFooter: true,
  isVatRegistered: true,
  timezone: true,
  logoKey: true,
} satisfies Prisma.TraiteurSelect;

export type Seller = Prisma.TraiteurGetPayload<{ select: typeof sellerSelect }>;

/** Bloc vendeur de l'en-tête : nom commercial, adresse et contacts. */
export function sellerHeader(seller: Seller): { name: string; lines: string[] } {
  const contact = [ltr(seller.phone), ltr(seller.email)].join(' — ');
  return {
    name: auto(seller.name),
    lines: [auto(seller.legalAddress ?? seller.city ?? ''), contact].filter(
      (line) => line.trim() !== '',
    ),
  };
}

/** Pied de page légal : raison sociale, forme, capital, ICE, RC, IF, patente, CNSS, RIB. */
export function sellerFooter(seller: Seller, locale: DocLocale): string[] {
  const labels = docLabels(locale).legal;
  const company = [
    seller.legalName ?? seller.name,
    seller.legalForm,
    seller.shareCapital !== null
      ? labels.capital(
          `${ltr(formatAmount(seller.shareCapital * 100).replace(/,00$/, ''))} ${locale === 'ar' ? 'درهم' : 'MAD'}`,
        )
      : null,
    seller.legalAddress,
  ]
    .filter((part): part is string => Boolean(part))
    .map(auto)
    .join(' — ');
  const identifiers = [
    seller.ice ? `${labels.ice} ${seller.ice}` : null,
    seller.rcNumber
      ? `${labels.rc} ${seller.rcNumber}${seller.rcCourt ? ` (${seller.rcCourt})` : ''}`
      : null,
    seller.taxId ? `${labels.taxId} ${seller.taxId}` : null,
    seller.patenteNumber ? `${labels.patente} ${seller.patenteNumber}` : null,
    seller.cnssNumber ? `${labels.cnss} ${seller.cnssNumber}` : null,
  ].filter((part): part is string => part !== null);
  const bank = seller.rib
    ? `${labels.rib} ${seller.rib}${seller.bankName ? ` — ${seller.bankName}` : ''}`
    : null;
  return [
    company,
    identifiers.length > 0 ? ltr(identifiers.join(' · ')) : null,
    bank ? ltr(bank) : null,
    seller.invoiceFooter ? auto(seller.invoiceFooter) : null,
  ].filter((line): line is string => Boolean(line));
}

/** Texte bilingue facultatif (conditions) dans la langue du document. */
export function localizedTerms(value: Prisma.JsonValue | null, locale: DocLocale): string | null {
  const parsed = localizedTextSchema.safeParse(value);
  if (!parsed.success) return null;
  const text = (locale === 'ar' ? parsed.data.ar : undefined) ?? parsed.data.fr;
  return text.trim() === '' ? null : text;
}
