'use client';

import { LogOutIcon } from 'lucide-react';
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

/** Menu de l'utilisateur connecté : nom, téléphone, déconnexion. */
export function UserMenu() {
  const t = useTranslations();
  const { user } = useSession();
  if (!user) return null;
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();

  async function logout() {
    await sessionStore.logout();
    toast.success(t('auth.loggedOut'));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.account')} className="rounded-full">
          <Avatar className="size-10">
            <AvatarFallback className="bg-primary/10 font-medium text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-base font-medium">
            {user.firstName} {user.lastName}
          </span>
          <span className="text-sm font-normal text-muted-foreground" dir="ltr">
            {user.phone}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-2.5 text-base" onSelect={() => void logout()}>
          <LogOutIcon aria-hidden />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
