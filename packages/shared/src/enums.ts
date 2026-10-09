import { z } from 'zod';

// Miroir des enums Prisma utilisés par les clients (web, mobile).
// Les valeurs doivent rester identiques à apps/api/prisma/schema.prisma.

export const ROLES = ['CLIENT', 'ADMIN_TRAITEUR', 'EMPLOYE', 'LIVREUR', 'SUPER_ADMIN'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Rôles qu'un Membership peut porter (SUPER_ADMIN est un attribut du User). */
export const TENANT_ROLES = ['CLIENT', 'ADMIN_TRAITEUR', 'EMPLOYE', 'LIVREUR'] as const;
export const tenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const SUBSCRIPTION_PLANS = ['BASIQUE', 'PRO', 'PREMIUM'] as const;
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export const EVENT_TYPES = [
  'WEDDING',
  'ENGAGEMENT',
  'BIRTHDAY',
  'AQIQA',
  'CORPORATE',
  'OTHER',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

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
