/**
 * Registre de TOUS les types d'action du journal d'audit. L'API n'enregistre que ces valeurs
 * (typage de AuditService) ; chacune a un libellé lisible en français et en arabe dans le
 * back-office (test des traductions). Ajouter une action : l'ajouter ici, puis ses libellés.
 */
const CATALOG_ITEMS = ['dish', 'package', 'service', 'buffet', 'equipment'] as const;
const CATALOG_ITEM_VERBS = ['created', 'updated', 'archived', 'restored', 'deleted'] as const;
const CATALOG_LISTS = ['event_type', 'range', 'equipment_category', 'buffet_type'] as const;
const CATALOG_LIST_VERBS = [
  'created',
  'updated',
  'archived',
  'restored',
  'deleted',
  'reordered',
] as const;

type CatalogItemAction =
  `catalog.${(typeof CATALOG_ITEMS)[number]}.${(typeof CATALOG_ITEM_VERBS)[number]}`;
type CatalogListAction =
  `catalog.${(typeof CATALOG_LISTS)[number]}.${(typeof CATALOG_LIST_VERBS)[number]}`;

const catalogItemActions = CATALOG_ITEMS.flatMap((item) =>
  CATALOG_ITEM_VERBS.map((verb): CatalogItemAction => `catalog.${item}.${verb}`),
);
const catalogListActions = CATALOG_LISTS.flatMap((list) =>
  CATALOG_LIST_VERBS.map((verb): CatalogListAction => `catalog.${list}.${verb}`),
);

const FIXED_ACTIONS = [
  // Compte et connexion
  'account.updated',
  'account.password_changed',
  'auth.login_failed',
  'auth.login_blocked',
  'auth.account_locked',
  'auth.password_reset',
  'auth.backoffice_denied',
  'auth.2fa_failed',
  'auth.2fa_enabled',
  'auth.2fa_disabled',
  'auth.2fa_recovery_codes_regenerated',
  'auth.2fa_recovery_code_used',
  // Catalogue (catégories)
  'catalog.category.created',
  'catalog.category.updated',
  'catalog.category.reordered',
  // Clients
  'client.created',
  'client.updated',
  'client.address_added',
  'client.address_updated',
  'client.address_removed',
  // Commandes, calendrier, matériel
  'order.created',
  'order.updated',
  'order.status_changed',
  'order.deposit_changed',
  'order.service_info_updated',
  'order.availability_overridden',
  'equipment.stock_overridden',
  'calendar.date_blocked',
  'calendar.date_unblocked',
  'calendar.capacity_changed',
  // Devis, factures, paiements
  'quote.prepared',
  'quote.updated',
  'quote.sent',
  'quote.accepted',
  'quote.rejected',
  'quote.expired',
  'quote.link_renewed',
  'quote.link_revoked',
  'invoice.issued',
  'invoice.credit_note_issued',
  'payment.recorded',
  'payment.collected',
  'payment.collection_rejected',
  'payment.remitted',
  'payment.refunded',
  'payment.voided',
  // Personnel, missions, permissions
  'staff.invited',
  'staff.invitation_renewed',
  'staff.invitation_cancelled',
  'staff.invitation_accepted',
  'staff.updated',
  'staff.suspended',
  'staff.reactivated',
  'assignment.created',
  'assignment.updated',
  'assignment.removed',
  'assignment.confirmed',
  'assignment.declined',
  'assignment.done',
  'permissions.updated',
  'permissions.reset',
  'membership.leaked_client_removed',
  // Paramètres
  'settings.company_updated',
  'settings.billing_updated',
  'settings.pricing_updated',
  'settings.availability_updated',
  'settings.logo_updated',
  'settings.logo_removed',
  // Plateforme
  'traiteur.created',
  'super_admin.created',
  'super_admin.activated',
  'super_admin.2fa_reset',
  'platform.traiteur_created',
  'platform.admin_invitation_resent',
  'platform.plan_changed',
  'platform.plan_price_changed',
  'platform.feature_toggled',
  'platform.traiteur_suspended',
  'platform.traiteur_reactivated',
  'platform.trial_updated',
  'platform.subscription_activated',
  'platform.permission_default_changed',
  'platform.access_started',
  'platform.access_extended',
  'platform.access_ended',
  'platform.access_request',
  'platform.domain_added',
  'platform.domain_verified',
  'platform.domain_disabled',
  'platform.domain_removed',
] as const;

export type AuditAction = (typeof FIXED_ACTIONS)[number] | CatalogItemAction | CatalogListAction;

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  ...FIXED_ACTIONS,
  ...catalogItemActions,
  ...catalogListActions,
];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Clé de traduction d'une action (le point est réservé à l'imbrication des messages). */
export function auditActionKey(action: AuditAction): string {
  return action.replaceAll('.', '_');
}
