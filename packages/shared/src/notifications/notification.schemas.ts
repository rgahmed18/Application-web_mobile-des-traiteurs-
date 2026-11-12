import { z } from 'zod';

import type { PermissionKey } from '../access/permissions';

/**
 * Notifications du traiteur (cloche du back-office) : nouveaux clients, demandes en ligne,
 * réponses aux devis. Chaque type n'est montré qu'aux membres qui ont la permission liée.
 */
export const NOTIFICATION_TYPES = [
  'CLIENT_SIGNED_UP',
  'CLIENT_APPROVAL_REQUESTED',
  'ORDER_REQUESTED',
  'ORDER_REQUEST_CANCELLED',
  'QUOTE_ACCEPTED',
  'QUOTE_REJECTED',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Permission nécessaire pour voir chaque type de notification. */
export const NOTIFICATION_PERMISSIONS: Record<NotificationType, PermissionKey> = {
  CLIENT_SIGNED_UP: 'clients.read',
  CLIENT_APPROVAL_REQUESTED: 'clients.approve',
  ORDER_REQUESTED: 'orders.read',
  ORDER_REQUEST_CANCELLED: 'orders.read',
  QUOTE_ACCEPTED: 'quotes.read',
  QUOTE_REJECTED: 'quotes.read',
};

/** Texte affichable seulement : nom du client, référence, motif. */
export const notificationDataSchema = z.object({
  clientName: z.string(),
  reference: z.string().nullable().default(null),
  /** Commande concernée (lien), pour un devis. */
  orderId: z.uuid().nullable().default(null),
  reason: z.string().nullable().default(null),
});
export type NotificationData = z.infer<typeof notificationDataSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  entityType: z.enum(['Membership', 'Order', 'Quote']),
  entityId: z.uuid(),
  data: notificationDataSchema,
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationFeedSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

/**
 * Canaux d'envoi. Seul IN_APP (la cloche) est actif ; SMS et WHATSAPP sont prévus (préférences
 * par membre et par type, à venir).
 */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];
