import type { TenantRole } from '../enums';

export interface PermissionDefinition {
  key: string;
  module: string;
  description: string;
  /** false = permission critique, non modifiable par le traiteur. */
  isTenantEditable: boolean;
  /** Rôles qui la reçoivent dans la matrice par défaut (RolePermission avec traiteurId = null). */
  defaultRoles: readonly TenantRole[];
}

const ADMIN = 'ADMIN_TRAITEUR';
const EMPLOYEE = 'EMPLOYE';
const DRIVER = 'LIVREUR';
const CLIENT = 'CLIENT';

/**
 * Catalogue des permissions. Sert uniquement à initialiser la base (seed) et à typer
 * les décorateurs : à l'exécution, les droits effectifs sont lus en base.
 */
// prettier-ignore
export const PERMISSIONS = [
  // Catalogue
  { key: 'catalog.read', module: 'catalog', description: 'Consulter le catalogue', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE, DRIVER, CLIENT] },
  { key: 'catalog.manage', module: 'catalog', description: 'Gérer plats, formules et services', isTenantEditable: true, defaultRoles: [ADMIN] },
  // Commandes
  { key: 'orders.read', module: 'orders', description: 'Consulter toutes les commandes', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'orders.read_own', module: 'orders', description: 'Consulter ses propres commandes', isTenantEditable: true, defaultRoles: [CLIENT] },
  { key: 'orders.create', module: 'orders', description: 'Créer une commande', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE, CLIENT] },
  { key: 'orders.manage', module: 'orders', description: 'Modifier et changer le statut des commandes', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'orders.cancel', module: 'orders', description: 'Annuler une commande', isTenantEditable: true, defaultRoles: [ADMIN] },
  // Calendrier et disponibilités
  { key: 'calendar.read', module: 'calendar', description: 'Consulter le calendrier', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'calendar.manage', module: 'calendar', description: 'Bloquer des dates, fixer la capacité', isTenantEditable: true, defaultRoles: [ADMIN] },
  // Devis
  { key: 'quotes.read', module: 'quotes', description: 'Consulter les devis', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'quotes.manage', module: 'quotes', description: 'Créer et envoyer des devis', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'quotes.respond', module: 'quotes', description: 'Accepter ou refuser un devis reçu', isTenantEditable: true, defaultRoles: [CLIENT] },
  // Facturation (critique)
  { key: 'invoices.read', module: 'invoices', description: 'Consulter les factures', isTenantEditable: true, defaultRoles: [ADMIN] },
  { key: 'invoices.issue', module: 'invoices', description: 'Émettre une facture', isTenantEditable: false, defaultRoles: [ADMIN] },
  { key: 'invoices.credit_note', module: 'invoices', description: 'Émettre un avoir', isTenantEditable: false, defaultRoles: [ADMIN] },
  // Paiements
  { key: 'payments.read', module: 'payments', description: 'Consulter les paiements', isTenantEditable: true, defaultRoles: [ADMIN] },
  { key: 'payments.record', module: 'payments', description: 'Enregistrer un paiement', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE, DRIVER] },
  { key: 'payments.refund', module: 'payments', description: 'Rembourser un paiement', isTenantEditable: false, defaultRoles: [ADMIN] },
  // Personnel et livraisons
  { key: 'staff.read', module: 'staff', description: 'Consulter le personnel', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'staff.manage', module: 'staff', description: 'Gérer le personnel et les affectations', isTenantEditable: true, defaultRoles: [ADMIN] },
  { key: 'assignments.read_own', module: 'staff', description: 'Consulter ses missions', isTenantEditable: true, defaultRoles: [EMPLOYEE, DRIVER] },
  { key: 'assignments.update_own', module: 'staff', description: 'Confirmer ou terminer ses missions', isTenantEditable: true, defaultRoles: [EMPLOYEE, DRIVER] },
  { key: 'deliveries.update_status', module: 'deliveries', description: 'Mettre à jour le statut de livraison', isTenantEditable: true, defaultRoles: [ADMIN, DRIVER] },
  // Clients
  { key: 'clients.read', module: 'clients', description: 'Consulter les fiches clients', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'clients.manage', module: 'clients', description: 'Modifier les fiches clients', isTenantEditable: true, defaultRoles: [ADMIN] },
  // Messagerie
  { key: 'conversations.read', module: 'conversations', description: 'Consulter les conversations', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  { key: 'conversations.reply', module: 'conversations', description: 'Répondre aux clients', isTenantEditable: true, defaultRoles: [ADMIN, EMPLOYEE] },
  // Avis
  { key: 'reviews.write_own', module: 'reviews', description: 'Laisser un avis sur sa commande', isTenantEditable: true, defaultRoles: [CLIENT] },
  { key: 'reviews.moderate', module: 'reviews', description: 'Publier et répondre aux avis', isTenantEditable: true, defaultRoles: [ADMIN] },
  // Paramètres et administration (critique)
  { key: 'settings.manage', module: 'settings', description: 'Modifier les paramètres du traiteur', isTenantEditable: false, defaultRoles: [ADMIN] },
  { key: 'permissions.manage', module: 'settings', description: 'Ajuster les permissions des rôles', isTenantEditable: false, defaultRoles: [ADMIN] },
  { key: 'subscription.read', module: 'billing', description: "Consulter l'abonnement", isTenantEditable: false, defaultRoles: [ADMIN] },
  { key: 'subscription.manage', module: 'billing', description: "Changer d'offre", isTenantEditable: false, defaultRoles: [ADMIN] },
  { key: 'audit.read', module: 'audit', description: "Consulter le journal d'audit", isTenantEditable: false, defaultRoles: [ADMIN] },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

export interface RolePermissionRule {
  permissionKey: string;
  granted: boolean;
}

/**
 * Calcule les permissions effectives d'un rôle chez un traiteur :
 * matrice par défaut, puis surcharges du traiteur, ignorées pour les permissions critiques.
 */
export function resolveEffectivePermissions(
  defaults: readonly RolePermissionRule[],
  overrides: readonly RolePermissionRule[],
  nonEditableKeys: ReadonlySet<string>,
): Set<string> {
  const effective = new Set<string>();
  for (const rule of defaults) {
    if (rule.granted) effective.add(rule.permissionKey);
  }
  for (const rule of overrides) {
    if (nonEditableKeys.has(rule.permissionKey)) continue;
    if (rule.granted) effective.add(rule.permissionKey);
    else effective.delete(rule.permissionKey);
  }
  return effective;
}
