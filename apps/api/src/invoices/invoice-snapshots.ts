import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { joinAddress } from '../pdf/document-model';
import { type Seller, sellerSelect } from '../pdf/seller';

/**
 * Vendeur et acheteur figés à l'émission (Invoice.sellerSnapshot / buyerSnapshot) : une facture
 * ne dépend plus des données vivantes (changement de raison sociale, de RIB, d'adresse…).
 */
export const sellerSnapshotSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  city: z.string().nullable(),
  legalName: z.string().nullable(),
  legalForm: z.string().nullable(),
  shareCapital: z.number().int().nullable(),
  ice: z.string().nullable(),
  rcNumber: z.string().nullable(),
  rcCourt: z.string().nullable(),
  taxId: z.string().nullable(),
  patenteNumber: z.string().nullable(),
  cnssNumber: z.string().nullable(),
  legalAddress: z.string().nullable(),
  bankName: z.string().nullable(),
  rib: z.string().nullable(),
  invoiceFooter: z.string().nullable(),
  isVatRegistered: z.boolean(),
  timezone: z.string(),
  logoKey: z.string().nullable(),
  /** Conditions de paiement imprimées, dans la langue de la facture. */
  paymentTerms: z.string().nullable(),
});
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;

export const buyerSnapshotSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  companyName: z.string().nullable(),
  ice: z.string().nullable(),
});
export type BuyerSnapshot = z.infer<typeof buyerSnapshotSchema>;

export const invoiceSellerSelect = {
  ...sellerSelect,
  paymentTerms: true,
  defaultTaxRateBps: true,
  cancellationFeeTaxRateBps: true,
  creditNoteNumbering: true,
  balanceDueDays: true,
} satisfies Prisma.TraiteurSelect;
export type InvoiceSeller = Prisma.TraiteurGetPayload<{ select: typeof invoiceSellerSelect }>;

export function sellerSnapshot(seller: InvoiceSeller, paymentTerms: string | null): SellerSnapshot {
  const fields: Seller = {
    name: seller.name,
    email: seller.email,
    phone: seller.phone,
    city: seller.city,
    legalName: seller.legalName,
    legalForm: seller.legalForm,
    shareCapital: seller.shareCapital,
    ice: seller.ice,
    rcNumber: seller.rcNumber,
    rcCourt: seller.rcCourt,
    taxId: seller.taxId,
    patenteNumber: seller.patenteNumber,
    cnssNumber: seller.cnssNumber,
    legalAddress: seller.legalAddress,
    bankName: seller.bankName,
    rib: seller.rib,
    invoiceFooter: seller.invoiceFooter,
    isVatRegistered: seller.isVatRegistered,
    timezone: seller.timezone,
    logoKey: seller.logoKey,
  };
  return { ...fields, paymentTerms };
}

export const buyerSelect = {
  firstName: true,
  lastName: true,
  email: true,
  locale: true,
  companyName: true,
  companyIce: true,
  user: { select: { phone: true } },
  addresses: {
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    take: 1,
    select: { address: true, city: true },
  },
} satisfies Prisma.MembershipSelect;
export type BuyerRow = Prisma.MembershipGetPayload<{ select: typeof buyerSelect }>;

export function buyerSnapshot(row: BuyerRow): BuyerSnapshot {
  const address = row.addresses[0];
  return {
    name: `${row.firstName} ${row.lastName}`.trim(),
    phone: row.user.phone,
    email: row.email,
    address: address ? joinAddress([address.address, address.city]) : null,
    companyName: row.companyName,
    ice: row.companyIce,
  };
}

/** Lecture d'un instantané (null s'il est illisible : données antérieures au format actuel). */
export function parseSeller(value: Prisma.JsonValue): SellerSnapshot | null {
  const parsed = sellerSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseBuyer(value: Prisma.JsonValue): BuyerSnapshot {
  const parsed = buyerSnapshotSchema.partial().safeParse(value);
  const data = parsed.success ? parsed.data : {};
  return {
    name: data.name ?? '',
    phone: data.phone ?? '',
    email: data.email ?? null,
    address: data.address ?? null,
    companyName: data.companyName ?? null,
    ice: data.ice ?? null,
  };
}
