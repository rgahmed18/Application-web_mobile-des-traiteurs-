import { z } from 'zod';

import { phoneSchema } from '../auth/phone';
import { booleanQuery, paginatedSchema } from '../catalog/catalog.schemas';
import { localeSchema } from '../i18n/localized-text';

/**
 * Clients d'un traiteur. Le compte (User) est global ; les coordonnées affichées et modifiables
 * par le traiteur (nom, email, langue, notes, tags, adresses) appartiennent au Membership : un
 * traiteur ne voit ni ne modifie jamais ce qu'un autre traiteur ou le client a saisi ailleurs.
 */

const nameSchema = z.string().trim().max(80);
const emailSchema = z.email('Adresse email invalide').trim().toLowerCase().max(160);
const tagSchema = z.string().trim().min(1).max(30);

export const clientAddressInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  isDefault: z.boolean(),
});
export type ClientAddressInput = z.infer<typeof clientAddressInputSchema>;

const clientFieldsSchema = z.object({
  firstName: nameSchema.min(1),
  lastName: nameSchema,
  email: emailSchema.nullable(),
  locale: localeSchema,
  tags: z.array(tagSchema).max(10),
  internalNotes: z.string().trim().max(2000).nullable(),
});

/**
 * Création par le traiteur (commande prise par téléphone, numéro étranger sans SMS). Si le
 * numéro a déjà un compte, il est rattaché : la réponse est identique à une création.
 */
export const clientCreateSchema = clientFieldsSchema.extend({
  phone: phoneSchema,
  address: clientAddressInputSchema.nullable(),
});
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

/** Le téléphone identifie le compte : il n'est pas modifiable par le traiteur. */
export const clientUpdateSchema = clientFieldsSchema;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const CLIENT_SORTS = ['name', 'createdAt', 'lastOrder', 'totalSpent'] as const;

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(30).optional(),
  sort: z.enum(CLIENT_SORTS).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  includeInactive: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

export const clientAddressSchema = clientAddressInputSchema.extend({ id: z.uuid() });
export type ClientAddress = z.infer<typeof clientAddressSchema>;

export const clientSummarySchema = z.object({
  /** Identifiant du Membership CLIENT chez ce traiteur. */
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  locale: localeSchema,
  tags: z.array(z.string()),
  active: z.boolean(),
  orderCount: z.number().int(),
  /** Somme TTC des commandes fermes (confirmées à clôturées), en centimes. */
  totalSpent: z.number().int(),
  /** Date de début du dernier événement (toutes commandes non annulées). */
  lastOrderAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;

export const clientSchema = clientSummarySchema.extend({
  internalNotes: z.string().nullable(),
  addresses: z.array(clientAddressSchema),
  /** Prochain événement à venir (commande non annulée). */
  nextOrderAt: z.iso.datetime().nullable(),
});
export type Client = z.infer<typeof clientSchema>;

export const clientPageSchema = paginatedSchema(clientSummarySchema);
export type ClientPage = z.infer<typeof clientPageSchema>;
