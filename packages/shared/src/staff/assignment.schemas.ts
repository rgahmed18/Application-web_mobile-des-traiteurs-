import { z } from 'zod';

import { phoneSchema } from '../auth/phone';
import { eventTypeSchema, orderStatusSchema, staffRoleSchema } from '../enums';
import { localizedTextSchema } from '../i18n/localized-text';
import { lineLabelSchema } from '../orders/line-label';
import { localDateSchema } from '../time/zoned';

/**
 * Affectations du personnel aux événements (missions), planning de l'équipe et informations de
 * service. Une mission ne contient jamais de prix, de total ni de note interne.
 */

/** Rôle tenu sur l'événement (indépendant du rôle d'accès du membre). */
export const ASSIGNMENT_ROLES = ['CHEF', 'COOK', 'WAITER', 'SUPERVISOR', 'DRIVER'] as const;
export const assignmentRoleSchema = z.enum(ASSIGNMENT_ROLES);
export type AssignmentRole = z.infer<typeof assignmentRoleSchema>;

export const ASSIGNMENT_STATUSES = ['ASSIGNED', 'CONFIRMED', 'DECLINED', 'DONE'] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

/** Alerte d'une commande : un membre ne peut pas venir, ou n'a pas confirmé 48 h avant. */
export const STAFF_ALERTS = ['DECLINED', 'UNCONFIRMED'] as const;
export const staffAlertSchema = z.enum(STAFF_ALERTS);
export type StaffAlert = z.infer<typeof staffAlertSchema>;

/** Modes d'encaissement à la livraison. */
export const COLLECTION_METHODS = ['CASH', 'CHEQUE'] as const;
export const collectionMethodSchema = z.enum(COLLECTION_METHODS);
export type CollectionMethod = z.infer<typeof collectionMethodSchema>;

/**
 * Encaissement déclaré par le livreur : en attente de remise, remis (validé par l'administrateur,
 * compté avec son reçu) ou refusé (motif).
 */
export const COLLECTION_STATUSES = ['PENDING', 'REMITTED', 'REJECTED'] as const;
export const collectionStatusSchema = z.enum(COLLECTION_STATUSES);
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;

const cashAmountSchema = z.number().int().min(1).max(10_000_000_000);

/** Date et heure locales du traiteur : « 2026-10-24T17:30 ». */
const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Date et heure invalides');

const moment = z.object({ date: z.string(), time: z.string() });

// ─────────────────────────── Saisies ───────────────────────────

const assignmentFields = z.object({
  staffRole: assignmentRoleSchema,
  startsAt: localDateTimeSchema,
  endsAt: localDateTimeSchema,
  notes: z.string().trim().max(500).nullable().default(null),
  /** Passer outre un chevauchement avec une autre mission du membre (tracé). */
  force: z.boolean().default(false),
  /** Montant TTC à encaisser à la livraison (chauffeur ou superviseur), avec son mode. */
  cashToCollect: cashAmountSchema.nullable().default(null),
  cashMethod: collectionMethodSchema.nullable().default(null),
});

const endsAfterStart = <T extends { startsAt: string; endsAt: string }>(value: T) =>
  value.endsAt > value.startsAt;
const endsAfterStartIssue = { message: 'La fin doit être après le début', path: ['endsAt'] };
const cashComplete = <T extends { cashToCollect: number | null; cashMethod: string | null }>(
  value: T,
) => (value.cashToCollect === null) === (value.cashMethod === null);
const cashCompleteIssue = { message: 'Montant et mode vont ensemble', path: ['cashMethod'] };

export const assignmentInputSchema = assignmentFields
  .extend({ membershipId: z.uuid() })
  .refine(endsAfterStart, endsAfterStartIssue)
  .refine(cashComplete, cashCompleteIssue);
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

export const assignmentUpdateSchema = assignmentFields
  .refine(endsAfterStart, endsAfterStartIssue)
  .refine(cashComplete, cashCompleteIssue);
export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>;

/** Lignes affectées au plus en une seule opération. */
export const MAX_ASSIGNMENT_BATCH = 30;

/**
 * Plusieurs membres affectés en une opération (une seule transaction) : chaque ligne a son rôle,
 * ses horaires, ses notes, son encaissement et son propre « passer outre ». Un membre ne figure
 * qu'une fois par rôle (il peut avoir deux rôles différents).
 */
export const assignmentBatchSchema = z
  .object({ lines: z.array(assignmentInputSchema).min(1).max(MAX_ASSIGNMENT_BATCH) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      const key = `${line.membershipId}:${line.staffRole}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'staffRole'],
          message: 'Ce membre a déjà ce rôle dans la liste',
          params: { i18n: 'duplicateAssignment' },
        });
      }
      seen.add(key);
    });
  });
export type AssignmentBatchInput = z.infer<typeof assignmentBatchSchema>;

/** Informations de service de la commande, jamais montrées au client. */
export const serviceInfoSchema = z.object({
  onSiteContactName: z.string().trim().max(120).nullable(),
  onSiteContactPhone: phoneSchema.nullable(),
  serviceNotes: z.string().trim().max(2000).nullable(),
  equipment: z.string().trim().max(2000).nullable(),
});
export type ServiceInfoInput = z.infer<typeof serviceInfoSchema>;

export const planningQuerySchema = z.object({
  /** Un jour de la semaine voulue (la semaine commence le lundi). */
  week: localDateSchema,
});
export type PlanningQuery = z.infer<typeof planningQuerySchema>;

export const missionDeclineSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type MissionDeclineInput = z.infer<typeof missionDeclineSchema>;

export const DELIVERY_STEPS = ['OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export const missionDeliverySchema = z.object({ to: z.enum(DELIVERY_STEPS) });
export type MissionDeliveryInput = z.infer<typeof missionDeliverySchema>;

/**
 * « Encaissé » : montant reçu du client et mode (formulaire multipart, la photo du chèque est
 * facultative). Les champs arrivent en texte, d'où la conversion du montant.
 */
export const missionCollectSchema = z.object({
  amount: z.coerce.number().pipe(cashAmountSchema),
  method: collectionMethodSchema,
  /** N° du chèque. */
  reference: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => value || null),
});
export type MissionCollectInput = z.infer<typeof missionCollectSchema>;

export const MISSION_SCOPES = ['upcoming', 'past'] as const;
export const missionListQuerySchema = z.object({
  scope: z.enum(MISSION_SCOPES).default('upcoming'),
});
export type MissionListQuery = z.infer<typeof missionListQuerySchema>;

// ─────────────────────────── Réponses (back-office) ───────────────────────────

export const assignmentConflictSchema = z.object({
  assignmentId: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  start: moment,
  end: moment,
});
export type AssignmentConflict = z.infer<typeof assignmentConflictSchema>;

/**
 * Problème d'une ligne d'affectation par lot (réponse 409 ASSIGNMENT_BATCH_CONFLICT).
 * Seul OVERLAP se lève ligne par ligne avec « force » ; les autres imposent de corriger la ligne.
 */
export const ASSIGNMENT_LINE_PROBLEMS = [
  'OVERLAP',
  'ASSIGNMENT_EXISTS',
  'MEMBER_NOT_FOUND',
  'MEMBER_UNAVAILABLE',
  'CASH_NOT_ALLOWED',
] as const;
export const assignmentLineProblemSchema = z.object({
  /** Position de la ligne dans le lot envoyé. */
  index: z.number().int().min(0),
  code: z.enum(ASSIGNMENT_LINE_PROBLEMS),
  /** OVERLAP : missions déjà enregistrées du membre qui chevauchent la ligne. */
  conflicts: z.array(assignmentConflictSchema),
  /** OVERLAP : autres lignes du lot, pour le même membre, qui chevauchent celle-ci. */
  lines: z.array(z.number().int().min(0)),
});
export type AssignmentLineProblem = z.infer<typeof assignmentLineProblemSchema>;
export const assignmentBatchConflictSchema = z.object({
  problems: z.array(assignmentLineProblemSchema),
});

/** Encaissement déclaré pour une affectation. */
export const cashDeclarationSchema = z.object({
  paymentId: z.uuid(),
  amount: z.number().int(),
  method: collectionMethodSchema,
  reference: z.string().nullable(),
  collectedAt: z.iso.datetime(),
  status: collectionStatusSchema,
  rejectReason: z.string().nullable(),
  hasPhoto: z.boolean(),
});
export type CashDeclaration = z.infer<typeof cashDeclarationSchema>;

export const assignmentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  member: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    role: staffRoleSchema,
    status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
  }),
  staffRole: assignmentRoleSchema,
  status: assignmentStatusSchema,
  start: moment,
  end: moment,
  notes: z.string().nullable(),
  declineReason: z.string().nullable(),
  respondedAt: z.iso.datetime().nullable(),
  cashToCollect: z.number().int().nullable(),
  cashMethod: collectionMethodSchema.nullable(),
  /** Dernière déclaration d'encaissement du livreur. */
  cashDeclaration: cashDeclarationSchema.nullable(),
  /** Autres missions du membre qui chevauchent celle-ci. */
  conflicts: z.array(assignmentConflictSchema),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const orderStaffingSchema = z.object({
  assignments: z.array(assignmentSchema),
  serviceInfo: serviceInfoSchema,
  alert: staffAlertSchema.nullable(),
});
export type OrderStaffing = z.infer<typeof orderStaffingSchema>;

export const planningSchema = z.object({
  weekStart: z.string(),
  days: z.array(z.string()),
  members: z.array(
    z.object({
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      role: staffRoleSchema,
      missions: z.array(
        z.object({
          id: z.uuid(),
          orderId: z.uuid(),
          orderReference: z.string(),
          eventType: eventTypeSchema,
          eventTypeName: localizedTextSchema,
          city: z.string(),
          staffRole: assignmentRoleSchema,
          status: assignmentStatusSchema,
          start: moment,
          end: moment,
          conflict: z.boolean(),
        }),
      ),
    }),
  ),
});
export type Planning = z.infer<typeof planningSchema>;

// ─────────────────────────── Missions (équipe, livreur) ───────────────────────────

export const missionSummarySchema = z.object({
  id: z.uuid(),
  orderReference: z.string(),
  orderStatus: orderStatusSchema,
  eventType: eventTypeSchema,
  /** Nom du type d'événement dans la liste du traiteur. */
  eventTypeName: localizedTextSchema,
  staffRole: assignmentRoleSchema,
  status: assignmentStatusSchema,
  start: moment,
  end: moment,
  eventDate: z.string(),
  guestCount: z.number().int(),
  /** Lieu affiché : nom de la salle, ou seulement la ville si la mission est masquée. */
  place: z.string(),
  city: z.string(),
  /** Mission terminée depuis le délai réglé : adresse et contact masqués. */
  redacted: z.boolean(),
});
export type MissionSummary = z.infer<typeof missionSummarySchema>;

export const missionSchema = missionSummarySchema.extend({
  event: z.object({
    date: z.string(),
    startTime: z.string(),
    endTime: z.string().nullable(),
    endsNextDay: z.boolean(),
  }),
  venue: z
    .object({
      name: z.string().nullable(),
      address: z.string(),
      city: z.string(),
      mapsUrl: z.url(),
      directionsUrl: z.url(),
    })
    .nullable(),
  contact: z.object({ name: z.string(), phone: z.string() }).nullable(),
  /** À livrer / à préparer : libellés et quantités, sans aucun prix. */
  content: z.array(
    z.object({
      label: lineLabelSchema,
      quantity: z.number().int(),
      itemType: z.enum(['DISH', 'PACKAGE', 'EXTRA_SERVICE', 'CUSTOM']),
    }),
  ),
  equipment: z.string().nullable(),
  serviceNotes: z.string().nullable(),
  missionNotes: z.string().nullable(),
  clientNotes: z.string().nullable(),
  team: z.array(
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      staffRole: assignmentRoleSchema,
      phone: z.string().nullable(),
      isSelf: z.boolean(),
    }),
  ),
  declineReason: z.string().nullable(),
  /** Étapes de livraison possibles maintenant (livreur affecté comme chauffeur). */
  deliverySteps: z.array(z.enum(DELIVERY_STEPS)),
  canConfirm: z.boolean(),
  canDecline: z.boolean(),
  canFinish: z.boolean(),
  documents: z.object({ deliveryNote: z.boolean(), preparationSheet: z.boolean() }),
  /**
   * Montant à encaisser à la livraison : présent seulement sur la mission concernée (chauffeur
   * ou superviseur pour qui l'administrateur l'a réglé). Seul montant jamais montré à l'équipe.
   */
  cashCollection: z
    .object({
      amount: z.number().int(),
      method: collectionMethodSchema,
      declaration: cashDeclarationSchema.nullable(),
      canDeclare: z.boolean(),
    })
    .nullable(),
});
export type Mission = z.infer<typeof missionSchema>;
