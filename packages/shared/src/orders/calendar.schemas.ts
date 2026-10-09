import { z } from 'zod';

import { booleanQuery } from '../catalog/catalog.schemas';
import { eventTypeSchema, orderStatusSchema } from '../enums';
import { localDateSchema } from '../time/zoned';

// ─────────────────────────── Calendrier ───────────────────────────

/** Période affichée : jours du traiteur, bornes incluses (93 jours au plus). */
export const calendarQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    includeCancelled: booleanQuery,
  })
  .refine((value) => value.from <= value.to, { path: ['to'], message: 'Période invalide' });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarOrderSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderStatusSchema,
  eventType: eventTypeSchema,
  date: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  endsNextDay: z.boolean(),
  clientName: z.string(),
  guestCount: z.number().int(),
  city: z.string(),
  totalTtc: z.number().int(),
});
export type CalendarOrder = z.infer<typeof calendarOrderSchema>;

export const calendarDaySchema = z.object({
  date: z.string(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  firmCount: z.number().int(),
  pendingCount: z.number().int(),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const calendarSchema = z.object({
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  capacity: z.number().int().nullable(),
  /** Tous les jours de la période, dans l'ordre. */
  days: z.array(calendarDaySchema),
  orders: z.array(calendarOrderSchema),
});
export type Calendar = z.infer<typeof calendarSchema>;

export const blockedDateInputSchema = z.object({
  date: localDateSchema,
  reason: z.string().trim().max(200).nullable(),
});
export type BlockedDateInput = z.infer<typeof blockedDateInputSchema>;

export const capacityInputSchema = z.object({
  /** Événements fermes maximum par jour ; null = pas de limite. */
  maxEventsPerDay: z.number().int().min(1).max(100).nullable(),
});
export type CapacityInput = z.infer<typeof capacityInputSchema>;

// ─────────────────────────── Tableau de bord ───────────────────────────

export const dashboardSchema = z.object({
  today: z.string(),
  /** Commandes du jour (non annulées, hors brouillons). */
  todayOrders: z.array(calendarOrderSchema),
  /** Commandes des 7 prochains jours (aujourd'hui exclu). */
  next7DaysCount: z.number().int(),
  /** En attente de confirmation (PENDING, QUOTED). */
  awaitingCount: z.number().int(),
  /** Commandes fermes non clôturées dont la date est passée. */
  toCloseCount: z.number().int(),
  /** « CA des événements du mois » : commandes fermes dont l'événement tombe dans le mois. */
  monthRevenue: z.object({
    month: z.string(),
    totalTtc: z.number().int(),
    orderCount: z.number().int(),
  }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
