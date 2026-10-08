import type { PermissionKey } from '@traiteur/shared';
import {
  CalendarDaysIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  SettingsIcon,
  UsersIcon,
  UtensilsIcon,
  UserRoundCogIcon,
} from 'lucide-react';

export interface NavItem {
  /** Clé de traduction dans l'espace « nav ». */
  labelKey: 'dashboard' | 'catalog' | 'orders' | 'calendar' | 'clients' | 'staff' | 'settings';
  href: string;
  icon: LucideIcon;
  /** Permission nécessaire pour voir l'entrée (aucune = toujours visible). */
  permission?: PermissionKey;
}

/** Menu du back-office, dans l'ordre d'affichage. */
export const NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'dashboard', href: '/admin', icon: LayoutDashboardIcon },
  { labelKey: 'catalog', href: '/admin/catalog', icon: UtensilsIcon, permission: 'catalog.read' },
  { labelKey: 'orders', href: '/admin/orders', icon: ClipboardListIcon, permission: 'orders.read' },
  {
    labelKey: 'calendar',
    href: '/admin/calendar',
    icon: CalendarDaysIcon,
    permission: 'calendar.read',
  },
  { labelKey: 'clients', href: '/admin/clients', icon: UsersIcon, permission: 'clients.read' },
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
