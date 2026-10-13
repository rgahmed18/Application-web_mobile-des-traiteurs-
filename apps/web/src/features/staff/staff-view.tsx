'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlanningView } from '@/features/assignments/planning-view';
import { usePermission } from '@/features/auth/session-provider';

import { PermissionsGrid } from './permissions-grid';
import { TeamList } from './team-list';

const TABS = ['team', 'planning', 'permissions'] as const;
type Tab = (typeof TABS)[number];

/** Personnel : équipe, planning et grille des permissions (onglet mémorisé dans l'URL). */
export function StaffView() {
  const t = useTranslations('staff');
  const can = usePermission();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('tab');
  const visible = TABS.filter((tab) => tab !== 'permissions' || can('permissions.manage'));
  const tab: Tab = visible.find((item) => item === requested) ?? 'team';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Tabs
        value={tab}
        onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}
      >
        <TabsList>
          {visible.map((item) => (
            <TabsTrigger key={item} value={item}>
              {t(`tabs.${item}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="team" className="pt-4">
          <TeamList />
        </TabsContent>
        <TabsContent value="planning" className="pt-4">
          <PlanningView />
        </TabsContent>
        {can('permissions.manage') && (
          <TabsContent value="permissions" className="pt-4">
            <PermissionsGrid />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
