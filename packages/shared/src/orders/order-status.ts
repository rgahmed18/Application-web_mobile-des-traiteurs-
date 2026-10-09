import type { PermissionKey } from '../access/permissions';
import type { OrderStatus } from '../enums';

/**
 * Cycle de vie d'une commande : machine à états explicite, partagée par l'API (qui l'impose)
 * et les applications (qui n'affichent que les actions permises).
 *
 *   DRAFT ─► PENDING ─► CONFIRMED ─► IN_PREPARATION ─► OUT_FOR_DELIVERY ─► DELIVERED ─► COMPLETED
 *     │        ▲  │         ▲  │            └──────── (service sur place) ───────┘
 *     │      QUOTED ────────┘  └─► PENDING (« déconfirmer », motif)
 *     └────────────► CONFIRMED (commande prise par téléphone)
 *   DRAFT, PENDING, QUOTED, CONFIRMED, IN_PREPARATION ─► CANCELLED (motif)
 */

/** Statuts qui engagent le traiteur : comptent dans la capacité du jour et le chiffre d'affaires. */
export const FIRM_ORDER_STATUSES = [
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
] as const satisfies readonly OrderStatus[];

/** En attente d'une décision du traiteur (carte « En attente » du tableau de bord). */
export const AWAITING_ORDER_STATUSES = [
  'PENDING',
  'QUOTED',
] as const satisfies readonly OrderStatus[];

/** Commandes en cours : à clôturer si la date de l'événement est passée. */
export const OPEN_FIRM_ORDER_STATUSES = [
  'CONFIRMED',
  'IN_PREPARATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];

export const TERMINAL_ORDER_STATUSES = [
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];

export function isFirmStatus(status: OrderStatus): boolean {
  return (FIRM_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

export interface OrderTransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  /** Une seule de ces permissions suffit. */
  permissions: readonly PermissionKey[];
  /** Motif obligatoire (annulation, retour en attente). */
  requiresReason: boolean;
  /** Contrôle de disponibilité du jour (date bloquée, capacité). */
  checksAvailability: boolean;
  /** Transition réservée aux traitements automatiques (devis : étape suivante). */
  automatic: boolean;
}

const WRITE = ['orders.write'] as const;
const DELIVERY = ['orders.write', 'deliveries.update_status'] as const;
const CANCEL = ['orders.cancel'] as const;

function rule(
  from: OrderStatus,
  to: OrderStatus,
  permissions: readonly PermissionKey[],
  options: Partial<
    Pick<OrderTransitionRule, 'requiresReason' | 'checksAvailability' | 'automatic'>
  > = {},
): OrderTransitionRule {
  return {
    from,
    to,
    permissions,
    requiresReason: options.requiresReason ?? false,
    checksAvailability: options.checksAvailability ?? false,
    automatic: options.automatic ?? false,
  };
}

const CANCELLABLE: readonly OrderStatus[] = [
  'DRAFT',
  'PENDING',
  'QUOTED',
  'CONFIRMED',
  'IN_PREPARATION',
];

export const ORDER_TRANSITIONS: readonly OrderTransitionRule[] = [
  rule('DRAFT', 'PENDING', WRITE),
  rule('DRAFT', 'CONFIRMED', WRITE, { checksAvailability: true }),
  rule('PENDING', 'CONFIRMED', WRITE, { checksAvailability: true }),
  rule('QUOTED', 'CONFIRMED', WRITE, { checksAvailability: true }),
  // Envoi, refus ou expiration d'un devis : gérés par le module devis (étape suivante)
  rule('PENDING', 'QUOTED', WRITE, { automatic: true }),
  rule('QUOTED', 'PENDING', WRITE, { automatic: true }),
  rule('CONFIRMED', 'PENDING', CANCEL, { requiresReason: true }),
  rule('CONFIRMED', 'IN_PREPARATION', WRITE),
  rule('IN_PREPARATION', 'OUT_FOR_DELIVERY', DELIVERY),
  rule('IN_PREPARATION', 'DELIVERED', DELIVERY),
  rule('OUT_FOR_DELIVERY', 'DELIVERED', DELIVERY),
  rule('DELIVERED', 'COMPLETED', WRITE),
  ...CANCELLABLE.map((from) => rule(from, 'CANCELLED', CANCEL, { requiresReason: true })),
];

export function findTransition(from: OrderStatus, to: OrderStatus): OrderTransitionRule | null {
  return ORDER_TRANSITIONS.find((item) => item.from === from && item.to === to) ?? null;
}

export type TransitionDenial =
  'INVALID_TRANSITION' | 'AUTOMATIC_TRANSITION' | 'MISSING_PERMISSION' | 'REASON_REQUIRED';

/**
 * Vérifie une transition demandée manuellement. Retourne la règle ou la raison du refus.
 * `permissions` : permissions effectives de l'utilisateur.
 */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  permissions: ReadonlySet<string>,
  reason?: string | null,
): { ok: true; rule: OrderTransitionRule } | { ok: false; denial: TransitionDenial } {
  const found = findTransition(from, to);
  if (!found) return { ok: false, denial: 'INVALID_TRANSITION' };
  if (found.automatic) return { ok: false, denial: 'AUTOMATIC_TRANSITION' };
  if (!found.permissions.some((key) => permissions.has(key))) {
    return { ok: false, denial: 'MISSING_PERMISSION' };
  }
  if (found.requiresReason && !reason?.trim()) return { ok: false, denial: 'REASON_REQUIRED' };
  return { ok: true, rule: found };
}

/** Transitions manuelles proposées à l'utilisateur pour une commande dans ce statut. */
export function availableTransitions(
  from: OrderStatus,
  permissions: ReadonlySet<string>,
): OrderTransitionRule[] {
  return ORDER_TRANSITIONS.filter(
    (item) =>
      item.from === from && !item.automatic && item.permissions.some((key) => permissions.has(key)),
  );
}

// ─────────────────── Modification d'une commande existante ───────────────────

/**
 * Champs d'une commande, regroupés selon les règles de modification :
 *   - free     : notes, notes internes, nom du lieu — sans motif tant que la commande est ouverte ;
 *   - framed   : date et heures, adresse, ville, type d'événement, invités, lignes — avec motif
 *                et la permission orders.edit_confirmed une fois la commande confirmée ;
 *   - date     : date et heures (cas particulier de « framed », interdit en préparation) ;
 *   - client   : interdit après confirmation (annuler puis recréer).
 */
export type OrderFieldGroup = 'internalNotes' | 'free' | 'framed' | 'date' | 'client';

export type OrderEditPolicy = Readonly<Record<OrderFieldGroup, 'allowed' | 'reason' | 'locked'>>;

const OPEN: OrderEditPolicy = {
  internalNotes: 'allowed',
  free: 'allowed',
  framed: 'allowed',
  date: 'allowed',
  client: 'allowed',
};

const CONFIRMED_POLICY: OrderEditPolicy = {
  internalNotes: 'allowed',
  free: 'allowed',
  framed: 'reason',
  date: 'reason',
  client: 'locked',
};

const READ_ONLY: OrderEditPolicy = {
  internalNotes: 'allowed',
  free: 'locked',
  framed: 'locked',
  date: 'locked',
  client: 'locked',
};

/** Ce qui peut être modifié, et comment, selon le statut. */
export function orderEditPolicy(status: OrderStatus): OrderEditPolicy {
  switch (status) {
    case 'DRAFT':
    case 'PENDING':
    case 'QUOTED':
      return OPEN;
    case 'CONFIRMED':
      return CONFIRMED_POLICY;
    case 'IN_PREPARATION':
      // La préparation est lancée : changer de date impose d'annuler
      return { ...CONFIRMED_POLICY, date: 'locked' };
    default:
      return READ_ONLY;
  }
}

/** Permission exigée pour les modifications « avec motif » (commande confirmée). */
export const EDIT_CONFIRMED_PERMISSION: PermissionKey = 'orders.edit_confirmed';

export type EditDenial = 'ORDER_LOCKED' | 'REASON_REQUIRED' | 'MISSING_PERMISSION';

/**
 * Vérifie une modification : `changed` = groupes de champs réellement modifiés.
 * Retourne null si elle est permise, sinon la raison du refus et le premier groupe en cause.
 */
export function checkOrderEdit(
  status: OrderStatus,
  changed: ReadonlySet<OrderFieldGroup>,
  permissions: ReadonlySet<string>,
  reason?: string | null,
): { denial: EditDenial; group: OrderFieldGroup } | null {
  const policy = orderEditPolicy(status);
  for (const group of changed) {
    const mode = policy[group];
    if (mode === 'locked') return { denial: 'ORDER_LOCKED', group };
    if (mode === 'reason') {
      if (!permissions.has(EDIT_CONFIRMED_PERMISSION))
        return { denial: 'MISSING_PERMISSION', group };
      if (!reason?.trim()) return { denial: 'REASON_REQUIRED', group };
    }
  }
  return null;
}

/** Une modification de ce statut doit-elle être justifiée (affichage du champ « motif ») ? */
export function editRequiresReason(
  status: OrderStatus,
  changed: ReadonlySet<OrderFieldGroup>,
): boolean {
  const policy = orderEditPolicy(status);
  return [...changed].some((group) => policy[group] === 'reason');
}
