import { z } from 'zod';

import { phoneSchema } from '../auth/phone';
import { eventTypeSchema } from '../enums';
import { localDateSchema, localTimeSchema } from '../time/zoned';

/**
 * Demande de prestation envoyée par un client depuis le site du traiteur : elle devient une
 * commande « En attente » au back-office, puis suit le parcours habituel (devis, acceptation,
 * acompte, confirmation). Le client n'envoie que des références du catalogue et des quantités :
 * les prix viennent toujours du catalogue, côté serveur.
 */

export const REQUEST_ITEM_KINDS = ['menu', 'buffet', 'equipment', 'service'] as const;
export const requestItemKindSchema = z.enum(REQUEST_ITEM_KINDS);
export type RequestItemKind = z.infer<typeof requestItemKindSchema>;

export const clientRequestItemSchema = z.object({
  kind: requestItemKindSchema,
  id: z.uuid(),
  /** Matériel et services à l'unité ; ignorée pour ce qui se compte par invité. */
  quantity: z.number().int().min(1).max(10_000),
});
export type ClientRequestItem = z.infer<typeof clientRequestItemSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);

/** Horaire de l'événement (fuseau du traiteur) : début, fin facultative, fin le lendemain. */
const scheduleSchema = z.object({
  eventDate: localDateSchema,
  startTime: localTimeSchema,
  endTime: localTimeSchema.nullable(),
  endsNextDay: z.boolean().default(false),
});

/** Indication de disponibilité, jamais de chiffres (capacité, stock). */
export const AVAILABILITY_HINTS = ['AVAILABLE', 'ON_REQUEST'] as const;
export const availabilityHintSchema = z.enum(AVAILABILITY_HINTS);
export type AvailabilityHint = z.infer<typeof availabilityHintSchema>;

export const clientAvailabilityQuerySchema = scheduleSchema.extend({
  equipment: z
    .array(z.object({ id: z.uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .max(50)
    .default([]),
});
export type ClientAvailabilityQuery = z.infer<typeof clientAvailabilityQuerySchema>;

export const clientAvailabilitySchema = z.object({
  date: availabilityHintSchema,
  equipment: z.array(z.object({ id: z.uuid(), status: availabilityHintSchema })),
});
export type ClientAvailability = z.infer<typeof clientAvailabilitySchema>;

export const clientRequestSchema = scheduleSchema
  .extend({
    eventType: eventTypeSchema,
    guestCount: z.number().int().min(1).max(10_000),
    venueName: optionalText(150),
    venueAddress: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(100),
    /** Enregistrer ce lieu dans les adresses du client (avec ce nom). */
    saveAddressAs: optionalText(60),
    onSiteContactName: optionalText(120),
    onSiteContactPhone: phoneSchema.nullable().default(null),
    notes: optionalText(2000),
    items: z.array(clientRequestItemSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    if (value.endTime !== null && !value.endsNextDay && value.endTime <= value.startTime) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'La fin doit être après le début',
        params: { i18n: 'endBeforeStart' },
      });
    }
  });
export type ClientRequestInput = z.infer<typeof clientRequestSchema>;

/** Demande créée : sa référence, pour la suivre dans l'espace du client. */
export const clientRequestCreatedSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
});
export type ClientRequestCreated = z.infer<typeof clientRequestCreatedSchema>;
