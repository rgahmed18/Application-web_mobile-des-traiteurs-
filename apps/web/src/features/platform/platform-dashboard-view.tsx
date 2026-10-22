'use client';

import type { PlatformDashboard, TraiteurStatus } from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';

import { LoadError } from '@/components/layout/load-error';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session-provider';
import { formatDateTime } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

import { usePlatformDashboard } from './platform-api';

/** Actions du journal qui ont un libellé (les autres s'affichent telles quelles). */
const KNOWN_ACTIONS = [
  'traiteur_created',
  'super_admin_created',
  'super_admin_activated',
  'super_admin_2fa_reset',
  'platform_traiteur_created',
  'platform_admin_invitation_resent',
] as const;
function isKnownAction(action: string): action is (typeof KNOWN_ACTIONS)[number] {
  return (KNOWN_ACTIONS as readonly string[]).includes(action);
}

const STATUS_CLASS: Record<TraiteurStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  TRIAL: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  SUSPENDED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function TraiteurStatusBadge({ status }: { status: TraiteurStatus }) {
  const t = useTranslations('platform.status');
  return (
    <Badge variant="outline" className={`border-transparent ${STATUS_CLASS[status]}`}>
      {t(status)}
    </Badge>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  testId: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`text-3xl font-semibold tabular-nums ${tone ?? ''}`} data-testid={testId}>
          {value}
        </span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

/** Évolution des commandes par rapport au mois précédent (pourcentage arrondi). */
export function orderVariation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Tableau de bord de la plateforme : chiffres agrégés uniquement, aucune donnée de client. */
export function PlatformDashboardView() {
  const t = useTranslations('platform.dashboard');
  const ta = useTranslations('platform.actions');
  const locale = useLocale();
  const { user } = useSession();
  const dashboard = usePlatformDashboard();

  if (dashboard.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!dashboard.data) return <LoadError error={dashboard.error} backHref="/platform" />;
  const data: PlatformDashboard = dashboard.data;
  const variation = orderVariation(data.ordersThisMonth, data.ordersLastMonth);
  const variationHint =
    variation === null
      ? t('noPreviousMonth')
      : t('variation', { percent: variation > 0 ? `+${variation}` : String(variation) });
  // Clés sans point (réservé à l'imbrication des messages) : « traiteur.created » → « traiteur_created »
  const actionLabel = (action: string) => {
    const key = action.replaceAll('.', '_');
    return isKnownAction(key) ? ta(key) : action;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title', { name: user?.firstName ?? '' })} description={t('subtitle')} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi testId="kpi-active" label={t('active')} value={String(data.traiteurs.active)} />
        <Kpi
          testId="kpi-trial"
          label={t('trial')}
          value={String(data.traiteurs.trial)}
          tone="text-indigo-600"
        />
        <Kpi
          testId="kpi-suspended"
          label={t('suspended')}
          value={String(data.traiteurs.suspended)}
          tone="text-rose-600"
        />
        <Kpi
          testId="kpi-orders"
          label={t('ordersThisMonth')}
          value={String(data.ordersThisMonth)}
          hint={variationHint}
        />
        <Kpi
          testId="kpi-revenue"
          label={t('revenue')}
          value={formatMoney(data.estimatedMonthlyRevenue, locale)}
          hint={t('revenueHint')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('activityTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.traiteurActivity.length === 0 ? (
              <p className="text-muted-foreground">{t('noTraiteur')}</p>
            ) : (
              <ul className="flex flex-col divide-y" data-testid="traiteur-activity">
                {data.traiteurActivity.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium" dir="auto">
                        {row.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.city ?? '—'}</span>
                    </div>
                    <span className="w-20 text-sm">{row.plan}</span>
                    <TraiteurStatusBadge status={row.status} />
                    <span className="w-24 text-end text-sm tabular-nums">
                      {t('orders', { count: row.ordersThisMonth })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('trialsTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.trialsEndingSoon.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noTrial')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm" data-testid="trials-ending">
                  {data.trialsEndingSoon.map((row) => (
                    <li key={row.id} className="flex justify-between gap-3">
                      <span dir="auto">{row.name}</span>
                      <span className="font-medium text-indigo-600">
                        {t('daysLeft', { count: row.daysLeft })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('actionsTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noAction')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {data.recentActions.map((row) => (
                    <li key={row.id} className="flex flex-col">
                      <span>
                        {actionLabel(row.action)}
                        {row.traiteurName && (
                          <span className="text-muted-foreground"> — {row.traiteurName}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.at)}
                        {row.actorName && ` · ${row.actorName}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('pricesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {(['BASIQUE', 'PRO', 'PREMIUM'] as const).map((plan) => (
                  <li key={plan} className="flex justify-between">
                    <span>{plan}</span>
                    <span className="tabular-nums">
                      {t('perMonth', { price: formatMoney(data.planPrices[plan], locale) })}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
