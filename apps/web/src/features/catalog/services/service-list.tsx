'use client';

import type { ExtraService } from '@traiteur/shared';
import { ConciergeBellIcon, PlusIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/session-provider';
import { formatMoney } from '@/lib/format/money';
import { EmptyState } from '@/components/layout/list-states';

import { useCatalogSettings, useExtraServices } from '../catalog-api';
import { CatalogHeader } from '../components/catalog-header';
import { StatusBadge } from '../components/catalog-ui';
import { ItemActions } from '../components/item-actions';
import { useLocalized } from '../use-localized';
import { ServiceFormDialog } from './service-form';

type Editing = { service?: ExtraService } | null;

export function ServiceList() {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const localized = useLocalized();
  const canWrite = usePermission()('catalog.write');
  const settings = useCatalogSettings();
  const [archived, setArchived] = useState(false);
  const services = useExtraServices(archived);
  const [editing, setEditing] = useState<Editing>(null);

  const ttcMode = settings.data?.priceEntryMode !== 'HT';
  const items = services.data ?? [];
  const canCreate = canWrite && settings.data !== undefined;

  const badge = (service: ExtraService) =>
    service.archivedAt ? (
      <StatusBadge tone="muted">{t('status.archived')}</StatusBadge>
    ) : service.isActive ? (
      <StatusBadge tone="success">{t('status.active')}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t('status.inactive')}</StatusBadge>
    );

  return (
    <div className="flex flex-col gap-6">
      <CatalogHeader
        action={
          canCreate && (
            <Button size="lg" onClick={() => setEditing({})}>
              <PlusIcon aria-hidden />
              {t('services.new')}
            </Button>
          )
        }
      />

      <Field orientation="horizontal" className="h-11">
        <Switch id="show-archived" checked={archived} onCheckedChange={setArchived} />
        <FieldLabel htmlFor="show-archived" className="text-base font-normal">
          {t('filters.showArchived')}
        </FieldLabel>
      </Field>

      {services.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ConciergeBellIcon}
          title={t('services.empty')}
          description={t('services.emptyHint')}
          action={
            canCreate &&
            !archived && (
              <Button size="lg" onClick={() => setEditing({})}>
                {t('services.new')}
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="service-list">
          {items.map((service) => {
            const name = localized(service.name);
            return (
              <li key={service.id} className="flex items-center gap-4 p-3 sm:p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{name}</p>
                    {service.description && (
                      <p className="truncate text-sm text-muted-foreground">
                        {localized(service.description)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="font-medium tabular-nums" dir="ltr">
                      {formatMoney(ttcMode ? service.priceTtc : service.priceHt, locale)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t(`pricingUnits.${service.pricingUnit}`)}
                    </span>
                    {badge(service)}
                  </div>
                </div>
                {canWrite && (
                  <ItemActions
                    resource="services"
                    id={service.id}
                    name={name}
                    archived={service.archivedAt !== null}
                    inUse={service.inUse}
                    onEdit={() => setEditing({ service })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && settings.data && (
        <ServiceFormDialog
          key={editing.service?.id ?? 'new'}
          settings={settings.data}
          service={editing.service}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
