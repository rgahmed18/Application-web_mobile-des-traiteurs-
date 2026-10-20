import { z } from 'zod';

// Miroir des enums Prisma utilisés par les clients (web, mobile).
// Les valeurs doivent rester identiques à apps/api/prisma/schema.prisma.

export const ROLES = [
  'CLIENT',
  'ADMIN_TRAITEUR',
  'EMPLOYE',
  'EQUIPE',
  'LIVREUR',
  'SUPER_ADMIN',
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Rôles qu'un Membership peut porter (SUPER_ADMIN est un attribut du User). */
export const TENANT_ROLES = ['CLIENT', 'ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR'] as const;
export const tenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

/**
 * Rôles du personnel : administrateur, bureau (commandes, devis, clients), équipe de terrain
 * (cuisine, service, extras : ses missions seulement) et livreur.
 */
export const STAFF_ROLES = ['ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES);
export type StaffMemberRole = z.infer<typeof staffRoleSchema>;

export const SUBSCRIPTION_PLANS = ['BASIQUE', 'PRO', 'PREMIUM'] as const;
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

/**
 * Code d'un type d'événement : la liste est gérée par chaque traiteur (table EventType, nom
 * traduit). Le code est stable ; les commandes le référencent.
 */
export const eventTypeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,39}$/, 'Type d’événement invalide');
export type EventType = z.infer<typeof eventTypeSchema>;

/** Types créés pour chaque traiteur (migration 20261020090000_event_types_ranges). */
export const DEFAULT_EVENT_TYPES = [
  'WEDDING',
  'ENGAGEMENT',
  'BIRTHDAY',
  'AQIQA',
  'CORPORATE',
  'THESIS',
  'OTHER',
] as const;

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING',
  'QUOTED',
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const LINE_ITEM_TYPES = ['DISH', 'PACKAGE', 'EXTRA_SERVICE', 'CUSTOM'] as const;
export const lineItemTypeSchema = z.enum(LINE_ITEM_TYPES);
export type LineItemType = z.infer<typeof lineItemTypeSchema>;
