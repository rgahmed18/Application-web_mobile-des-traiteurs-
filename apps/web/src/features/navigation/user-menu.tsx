'use client';

import { LogOutIcon, UserRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/features/auth/session-provider';
import { sessionStore } from '@/features/auth/session-store';

/**
 * Menu de l'utilisateur connecté : nom, téléphone, « Mon compte », déconnexion. Le super admin
 * est toujours présenté comme tel (« Super Admin · plateforme », SA), y compris chez un
 * traiteur : jamais confondu avec l'administrateur du traiteur.
 */
export function UserMenu({
  accountHref = '/admin/settings?tab=account',
}: {
  /** Page « Mon compte » de l'espace (back-office ou console). */
  accountHref?: string;
}) {
  const t = useTranslations();
  const { user, platformAccess } = useSession();
  if (!user) return null;
  const superAdmin = user.isSuperAdmin;
  const initials = superAdmin
    ? 'SA'
    : `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();

  async function logout() {
    await sessionStore.logout();
    toast.success(t('auth.loggedOut'));
  }

  return (
    <DropdownMenu>
      {platformAccess && (
        <span
          className="hidden items-center rounded-full bg-[#1b1840] px-3 py-1 text-xs font-bold text-amber-300 sm:inline-flex"
          data-testid="super-admin-identity"
        >
          {t('platform.identity')}
        </span>
      )}
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.account')} className="rounded-full">
          <Avatar className="size-10">
            <AvatarFallback
              className={
                superAdmin
                  ? 'bg-[#1b1840] font-bold text-amber-300'
                  : 'bg-primary/10 font-medium text-primary'
              }
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          {superAdmin && <span className="text-base font-semibold">{t('platform.identity')}</span>}
          <span className={superAdmin ? 'text-sm font-normal' : 'text-base font-medium'}>
            {user.firstName} {user.lastName}
          </span>
          <span className="text-sm font-normal text-muted-foreground" dir="ltr">
            {user.phone}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="py-2.5 text-base">
          <Link href={accountHref}>
            <UserRoundIcon aria-hidden />
            {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="py-2.5 text-base" onSelect={() => void logout()}>
          <LogOutIcon aria-hidden />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
