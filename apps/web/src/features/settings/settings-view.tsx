'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission } from '@/features/auth/session-provider';

import { AccountTab } from './account-forms';
import { BillingSettingsTab } from './billing-settings-form';
import { AvailabilityTab, CompanyTab, PricingTab } from './settings-forms';

const TABS = ['company', 'billing', 'availability', 'pricing', 'account'] as const;
type Tab = (typeof TABS)[number];

/**
 * Paramètres en onglets (onglet mémorisé dans l'URL). Les réglages du traiteur demandent
 * settings.manage ; « Mon compte » est ouvert à tout utilisateur connecté.
 */
export function SettingsView() {
  const t = useTranslations('settings');
  const can = usePermission();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const manage = can('settings.manage');
  const visible = TABS.filter((tab) => manage || tab === 'account');
  const requested = params.get('tab');
  const tab: Tab = visible.find((item) => item === requested) ?? visible[0] ?? 'account';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={manage ? t('title') : t('tabs.account')}
        description={manage ? t('subtitle') : undefined}
      />
      <Tabs
        value={tab}
        onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}
      >
        {visible.length > 1 && (
          <TabsList className="h-auto flex-wrap">
            {visible.map((item) => (
              <TabsTrigger key={item} value={item}>
                {t(`tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {manage && (
          <>
            <TabsContent value="company" className="flex flex-col gap-4 pt-4">
              <CompanyTab />
              <BillingSettingsTab section="legal" />
            </TabsContent>
            <TabsContent value="billing" className="pt-4">
              <BillingSettingsTab section="documents" />
            </TabsContent>
            <TabsContent value="availability" className="pt-4">
              <AvailabilityTab />
            </TabsContent>
            <TabsContent value="pricing" className="pt-4">
              <PricingTab />
            </TabsContent>
          </>
        )}
        <TabsContent value="account" className="pt-4">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
