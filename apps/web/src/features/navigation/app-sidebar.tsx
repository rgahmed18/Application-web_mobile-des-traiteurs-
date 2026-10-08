'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Brand } from '@/components/layout/brand';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePermission } from '@/features/auth/session-provider';

import { isNavItemActive, NAV_ITEMS } from './nav-items';

/** Menu latéral : à droite en arabe, en tiroir sur téléphone et tablette. */
export function AppSidebar() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const can = usePermission();
  const { isMobile, setOpenMobile } = useSidebar();
  const rtl = locale === 'ar';
  const items = NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  return (
    <Sidebar side={rtl ? 'right' : 'left'} dir={rtl ? 'rtl' : 'ltr'} collapsible="offcanvas">
      <SidebarHeader className="p-4">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('mainMenu')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    size="lg"
                    isActive={isNavItemActive(item, pathname)}
                    className="text-base"
                  >
                    <Link
                      href={item.href}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <item.icon aria-hidden />
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
