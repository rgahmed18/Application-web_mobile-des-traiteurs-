'use client';

import {
  type PlatformTraiteurCreateResult,
  type PlatformTraiteurDetail,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  todayInTimeZone,
} from '@traiteur/shared';
import { ArrowLeftIcon, BanIcon, PlayIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { LoadError } from '@/components/layout/load-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate, formatDateTime } from '@/lib/format/date';

import { useActionLabel } from './action-label';
import { AdminLinkDialog } from './admin-link-dialog';
import { usePlatformTraiteur, useResendAdminInvitation, useTraiteurAction } from './platform-api';
import { TraiteurStatusBadge } from './platform-dashboard-view';

const PLATFORM_TIMEZONE = 'Africa/Casablanca';

/**
 * Fiche d'un traiteur dans la console : offre, fonctionnalités, essai, suspension et
 * réactivation, administrateur, historique des actions de la plateforme. Aucune donnée de ses
 * clients n'y figure.
 */
export function TraiteurDetailView({ id }: { id: string }) {
  const t = useTranslations('platform.detail');
  const traiteur = usePlatformTraiteur(id);
  if (traiteur.isPending) return <Skeleton className="h-96 w-full" />;
  if (!traiteur.data) return <LoadError error={traiteur.error} backHref="/platform/traiteurs" />;
  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" className="self-start">
        <Link href="/platform/traiteurs">
          <ArrowLeftIcon aria-hidden className="rtl:rotate-180" />
          {t('back')}
        </Link>
      </Button>
      <TraiteurDetail detail={traiteur.data} />
    </div>
  );
}

function TraiteurDetail({ detail }: { detail: PlatformTraiteurDetail }) {
  const t = useTranslations('platform.detail');
  const tf = useTranslations('platform.features');
  const historyLabel = useActionLabel();
  const describeError = useErrorMessage();
  const action = useTraiteurAction(detail.id);
  const resend = useResendAdminInvitation();
  const [plan, setPlan] = useState<SubscriptionPlan>(detail.plan);
  const [applyFeatures, setApplyFeatures] = useState(true);
  const [trialEndsOn, setTrialEndsOn] = useState(
    detail.trialEndsAt ? todayInTimeZone(PLATFORM_TIMEZONE, new Date(detail.trialEndsAt)) : '',
  );
  const [suspending, setSuspending] = useState(false);
  const [link, setLink] = useState<PlatformTraiteurCreateResult | null>(null);

  const run = (
    request: { method: 'POST' | 'PUT'; path: string; body?: Record<string, unknown> },
    success: string,
  ) =>
    action.mutate(request, {
      onSuccess: () => toast.success(success),
      onError: (error) => toast.error(describeError(error)),
    });

  return (
    <div className="flex flex-col gap-6" data-testid="traiteur-detail">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold sm:text-3xl" dir="auto">
          {detail.name}
        </h1>
        <TraiteurStatusBadge status={detail.status} />
        <span className="text-sm text-muted-foreground" dir="ltr">
          {detail.slug}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {detail.city ?? '—'} · <span dir="ltr">{detail.phone}</span> ·{' '}
        <span dir="ltr">{detail.email}</span> ·{' '}
        {t('createdOn', { date: formatDate(detail.createdAt) })}
      </p>

      {detail.status === 'SUSPENDED' && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
          role="alert"
        >
          <span>
            {t('suspendedSince', {
              date: detail.suspendedAt ? formatDateTime(detail.suspendedAt) : '—',
              reason: detail.suspensionReason ?? '—',
            })}
          </span>
          <Button
            type="button"
            disabled={action.isPending}
            onClick={() => run({ method: 'POST', path: '/reactivate' }, t('reactivated'))}
          >
            <PlayIcon aria-hidden />
            {t('reactivate')}
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('planTitle')}</CardTitle>
            <CardDescription>{t('planHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={plan} onValueChange={(value) => setPlan(value as SubscriptionPlan)}>
              <SelectTrigger className="w-full sm:w-60" aria-label={t('planTitle')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_PLANS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={applyFeatures}
                onCheckedChange={(checked) => setApplyFeatures(checked === true)}
              />
              {t('applyFeatures')}
            </label>
            <Button
              type="button"
              className="self-start"
              disabled={action.isPending || plan === detail.plan}
              onClick={() =>
                run(
                  {
                    method: 'PUT',
                    path: '/plan',
                    body: { plan, applyPlanFeatures: applyFeatures },
                  },
                  t('planSaved'),
                )
              }
            >
              {t('changePlan')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('subscriptionTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {detail.status === 'TRIAL' ? (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  {t('trialEndsOn')}
                  <Input
                    type="date"
                    dir="ltr"
                    className="w-full sm:w-52"
                    value={trialEndsOn}
                    onChange={(event) => setTrialEndsOn(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={action.isPending || trialEndsOn === ''}
                    onClick={() =>
                      run({ method: 'PUT', path: '/trial', body: { trialEndsOn } }, t('trialSaved'))
                    }
                  >
                    {t('saveTrial')}
                  </Button>
                  <Button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => run({ method: 'POST', path: '/activate' }, t('activated'))}
                  >
                    {t('activateNow')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t(`statusText.${detail.status}`)}</p>
            )}
            {detail.status !== 'SUSPENDED' && detail.status !== 'CANCELLED' && (
              <Button
                type="button"
                variant="destructive"
                className="self-start"
                onClick={() => setSuspending(true)}
              >
                <BanIcon aria-hidden />
                {t('suspend')}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('featuresTitle')}</CardTitle>
            <CardDescription>{t('featuresHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y" data-testid="traiteur-features">
              {detail.features.map((feature) => (
                <li key={feature.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex flex-col">
                    <span>{tf(feature.key)}</span>
                    {feature.includedInPlan && (
                      <span className="text-xs text-muted-foreground">{t('inPlan')}</span>
                    )}
                  </span>
                  <Switch
                    checked={feature.enabled}
                    disabled={action.isPending}
                    aria-label={tf(feature.key)}
                    onCheckedChange={(enabled) =>
                      run(
                        { method: 'PUT', path: `/features/${feature.key}`, body: { enabled } },
                        enabled ? t('featureOn') : t('featureOff'),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('adminTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {detail.admin ? (
                <>
                  <span dir="auto">
                    {detail.admin.firstName} {detail.admin.lastName} ·{' '}
                    <span dir="ltr">{detail.admin.phone}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {t(`adminStatus.${detail.admin.status}`)}
                  </span>
                  {detail.admin.status === 'INVITED' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      disabled={resend.isPending}
                      onClick={() =>
                        resend.mutate(detail.id, {
                          onSuccess: setLink,
                          onError: (error) => toast.error(describeError(error)),
                        })
                      }
                    >
                      <SendIcon aria-hidden />
                      {t('resend')}
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('historyTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm" data-testid="traiteur-history">
                  {detail.history.map((entry) => (
                    <li key={entry.id} className="flex flex-col">
                      <span>
                        {historyLabel(entry.action)}
                        {entry.reason && (
                          <span className="text-muted-foreground"> — {entry.reason}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at)}
                        {entry.actorName && ` · ${entry.actorName}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={suspending}
        title={t('suspendTitle', { name: detail.name })}
        description={t('suspendDescription')}
        label={t('suspendReason')}
        placeholder={t('suspendPlaceholder')}
        confirmLabel={t('suspend')}
        destructive
        pending={action.isPending}
        onCancel={() => setSuspending(false)}
        onConfirm={(reason) => {
          setSuspending(false);
          run({ method: 'POST', path: '/suspend', body: { reason } }, t('suspended'));
        }}
      />
      <AdminLinkDialog result={link} onClose={() => setLink(null)} />
    </div>
  );
}
