import {
  addDays,
  computePaymentSchedule,
  eventTypeSchema,
  type LocalizedText,
  localizedTextSchema,
  plannedDeposit,
} from '@traiteur/shared';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { toLocalized } from '../catalog/catalog-common';
import { toSchedule } from '../orders/order-mapper';
import { localizedTerms } from '../pdf/seller';

/**
 * Devis envoyés avant les types d'événement gérables (le nom n'était pas figé) : nom par défaut
 * de leur code, identique à la liste créée par la migration 20261020090000.
 */
const LEGACY_EVENT_TYPE_NAMES: Record<string, LocalizedText> = {
  WEDDING: { fr: 'Mariage', ar: 'عرس' },
  ENGAGEMENT: { fr: 'Fiançailles', ar: 'خطوبة' },
  BIRTHDAY: { fr: 'Anniversaire', ar: 'عيد ميلاد' },
  AQIQA: { fr: 'Aqiqa', ar: 'عقيقة' },
  CORPORATE: { fr: 'Événement d’entreprise', ar: 'حفل شركة' },
  OTHER: { fr: 'Autre', ar: 'أخرى' },
};

/**
 * Données d'un devis figées à l'envoi (Quote.snapshot) : ce que le client a reçu reste lisible
 * même si la commande, le client ou les réglages changent ensuite. Les lignes, elles, sont
 * figées dans QuoteLine (trigger QuoteLine_frozen).
 */
export const quoteSnapshotSchema = z.object({
  v: z.literal(1),
  issuedOn: z.string(),
  orderReference: z.string(),
  seller: z.object({ name: z.string(), phone: z.string(), email: z.string() }),
  client: z.object({ name: z.string(), phone: z.string(), email: z.string().nullable() }),
  event: z
    .object({
      type: eventTypeSchema,
      /** Nom du type à l'envoi (absent des devis envoyés avant les types gérables). */
      typeName: localizedTextSchema.optional(),
      date: z.string(),
      startTime: z.string(),
      endTime: z.string().nullable(),
      endsNextDay: z.boolean(),
      guestCount: z.number().int(),
      venueName: z.string().nullable(),
      venueAddress: z.string(),
      city: z.string(),
    })
    .transform((event) => ({
      ...event,
      typeName: event.typeName ?? LEGACY_EVENT_TYPE_NAMES[event.type] ?? { fr: event.type },
    })),
  /** Conditions du traiteur dans les deux langues (PDF : langue du devis ; page : celle du client). */
  terms: z.object({ fr: z.string().nullable(), ar: z.string().nullable() }),
  /** Échéancier proposé si le devis est accepté le jour de l'envoi. */
  schedule: z.array(
    z.object({
      kind: z.enum(['DEPOSIT', 'BALANCE', 'FULL']),
      amount: z.number().int(),
      dueDate: z.string().nullable(),
    }),
  ),
});
export type QuoteSnapshot = z.output<typeof quoteSnapshotSchema>;

export const snapshotOrderSelect = {
  reference: true,
  eventType: true,
  eventTypeRef: { select: { name: true } },
  eventDate: true,
  eventEndDate: true,
  guestCount: true,
  venueName: true,
  venueAddress: true,
  city: true,
  depositAmount: true,
  client: {
    select: {
      firstName: true,
      lastName: true,
      email: true,
      locale: true,
      user: { select: { phone: true } },
    },
  },
} satisfies Prisma.OrderSelect;
export type SnapshotOrder = Prisma.OrderGetPayload<{ select: typeof snapshotOrderSelect }>;

export const snapshotSettingsSelect = {
  name: true,
  phone: true,
  email: true,
  timezone: true,
  depositPercentBps: true,
  balanceDueDays: true,
  quoteTerms: true,
} satisfies Prisma.TraiteurSelect;
export type SnapshotSettings = Prisma.TraiteurGetPayload<{ select: typeof snapshotSettingsSelect }>;

export function buildSnapshot(input: {
  order: SnapshotOrder;
  settings: SnapshotSettings;
  totalTtc: number;
  today: string;
}): QuoteSnapshot {
  const { order, settings, totalTtc, today } = input;
  const schedule = toSchedule(order, settings.timezone);
  const deposit =
    order.depositAmount > 0
      ? Math.min(order.depositAmount, totalTtc)
      : plannedDeposit(totalTtc, settings.depositPercentBps);
  const plan = computePaymentSchedule({
    totalTtc,
    depositAmount: deposit,
    depositPercentBps: settings.depositPercentBps,
    balanceDueDays: settings.balanceDueDays,
    // Hypothèse affichée au client : accord le jour même (acompte dû à la confirmation)
    confirmedOn: today,
    eventDate: schedule.eventDate,
    paid: 0,
    today,
    cancelled: false,
  });
  return {
    v: 1,
    issuedOn: today,
    orderReference: order.reference,
    seller: { name: settings.name, phone: settings.phone, email: settings.email },
    client: {
      name: `${order.client.firstName} ${order.client.lastName}`.trim(),
      phone: order.client.user.phone,
      email: order.client.email,
    },
    event: {
      type: order.eventType,
      typeName: toLocalized(order.eventTypeRef.name),
      date: schedule.eventDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      endsNextDay: schedule.endsNextDay,
      guestCount: order.guestCount,
      venueName: order.venueName,
      venueAddress: order.venueAddress,
      city: order.city,
    },
    terms: {
      fr: localizedTerms(settings.quoteTerms, 'fr'),
      ar: localizedTerms(settings.quoteTerms, 'ar'),
    },
    schedule: plan.installments.map((item) => ({
      kind: item.kind,
      amount: item.amount,
      // Acompte : dû à la confirmation (date inconnue à l'envoi)
      dueDate: item.kind === 'BALANCE' ? item.dueDate : null,
    })),
  };
}

/** Lecture d'un instantané enregistré (null s'il est absent ou illisible). */
export function parseSnapshot(value: Prisma.JsonValue | null): QuoteSnapshot | null {
  const parsed = quoteSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Fin de validité : lendemain 00:00 du dernier jour valable (instant UTC). */
export function validityEnd(validUntil: string): string {
  return addDays(validUntil, 1);
}
