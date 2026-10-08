'use client';

import {
  CalendarCheckIcon,
  CalendarClockIcon,
  FileTextIcon,
  type LucideIcon,
  WalletIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/session-provider';

type CardKey = 'todayEvents' | 'upcomingEvents' | 'pendingQuotes' | 'monthRevenue';

const CARDS: readonly { key: CardKey; icon: LucideIcon }[] = [
  { key: 'todayEvents', icon: CalendarCheckIcon },
  { key: 'upcomingEvents', icon: CalendarClockIcon },
  { key: 'pendingQuotes', icon: FileTextIcon },
  { key: 'monthRevenue', icon: WalletIcon },
];

/** Tableau de bord : squelette, alimenté par le module Commandes dans une prochaine étape. */
export function DashboardView() {
  const t = useTranslations('dashboard');
  const { user } = useSession();

  return (
    <>
      <PageHeader
        title={user ? t('welcome', { name: user.firstName }) : t('title')}
        description={t('subtitle')}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base font-medium">{t(`cards.${key}`)}</CardTitle>
              <Icon className="size-5 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <span className="text-3xl font-semibold text-muted-foreground" aria-hidden>
                —
              </span>
              <CardDescription>{t('notAvailableYet')}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
