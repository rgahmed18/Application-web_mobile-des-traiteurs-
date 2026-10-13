import type { PermissionKey } from '@traiteur/shared';
import {
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
  UtensilsIcon,
  UserRoundCogIcon,
} from 'lucide-react';

export interface NavItem {
  /** Clé de traduction dans l'espace « nav ». */
  labelKey:
    | 'dashboard'
    | 'missions'
    | 'catalog'
    | 'orders'
    | 'calendar'
    | 'clients'
    | 'invoices'
    | 'staff'
    | 'settings';
  href: string;
  icon: LucideIcon;
  /** Permission nécessaire pour voir l'entrée (aucune = toujours visible). */
  permission?: PermissionKey;
}

/** Menu du back-office, dans l'ordre d'affichage. */
export const NAV_ITEMS: readonly NavItem[] = [
  // Personnel de terrain et livreurs (sans « Consulter toutes les commandes ») : leurs missions
  { labelKey: 'dashboard', href: '/admin', icon: LayoutDashboardIcon, permission: 'orders.read' },
  {
    labelKey: 'missions',
    href: '/admin/missions',
    icon: ClipboardCheckIcon,
    permission: 'assignments.read_own',
  },
  { labelKey: 'catalog', href: '/admin/catalog', icon: UtensilsIcon, permission: 'catalog.read' },
  { labelKey: 'orders', href: '/admin/orders', icon: ClipboardListIcon, permission: 'orders.read' },
  {
    labelKey: 'calendar',
    href: '/admin/calendar',
    icon: CalendarDaysIcon,
    permission: 'calendar.read',
  },
  { labelKey: 'clients', href: '/admin/clients', icon: UsersIcon, permission: 'clients.read' },
  {
    labelKey: 'invoices',
    href: '/admin/invoices',
    icon: ReceiptTextIcon,
    permission: 'invoices.read',
  },
  { labelKey: 'staff', href: '/admin/staff', icon: UserRoundCogIcon, permission: 'staff.read' },
  {
    labelKey: 'settings',
    href: '/admin/settings',
    icon: SettingsIcon,
    permission: 'settings.manage',
  },
];

/** L'entrée est active sur sa page et ses sous-pages (le tableau de bord seulement sur /admin). */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.href === '/admin'
    ? pathname === '/admin'
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
