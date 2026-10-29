'use client';

import { FEATURE_KEYS, type PlatformPlans } from '@traiteur/shared';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { LoadError } from '@/components/layout/load-error';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';
import { currencyLabel, formatMoney, parseAmountToCents } from '@/lib/format/money';

import { usePlatformPlans, useSetPlanPrice } from './platform-api';

type Plan = PlatformPlans['plans'][number];

/** Prix mensuel d'une offre : nouveau prix en vigueur tout de suite, historique conservé. */
function PlanCard({ plan }: { plan: Plan }) {
  const t = useTranslations('platform.plans');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const save = useSetPlanPrice();
  const [price, setPrice] = useState('');
  const cents = parseAmountToCents(price);

  return (
    <Card data-testid={`plan-${plan.plan}`}>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span>{plan.plan}</span>
          <span className="text-xl tabular-nums" data-testid={`plan-price-${plan.plan}`}>
            {t('perMonth', { price: formatMoney(plan.monthlyPrice, locale) })}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('traiteurs', { count: plan.traiteurs })}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (cents === null) return;
            save.mutate(
              { plan: plan.plan, monthlyPrice: cents },
              {
                onSuccess: () => {
                  setPrice('');
                  toast.success(t('saved'));
                },
                onError: (error) => toast.error(describeError(error)),
              },
            );
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('newPrice')}
            <InputGroup className="w-48">
              <InputGroupInput
                value={price}
                inputMode="decimal"
                dir="ltr"
                aria-label={t('newPriceFor', { plan: plan.plan })}
                onChange={(event) => setPrice(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{currencyLabel(locale)}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </label>
          <Button type="submit" disabled={cents === null || save.isPending}>
            {t('apply')}
          </Button>
        </form>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('history')}</span>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {plan.history.slice(0, 6).map((row) => (
              <li key={row.effectiveFrom} className="flex justify-between gap-2">
                <span className="tabular-nums">{formatMoney(row.monthlyPrice, locale)}</span>
                <span>
                  {formatDateTime(row.effectiveFrom)}
                  {' · '}
                  <bdi>{row.createdBy ?? t('initial')}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/** Offres et fonctionnalités : prix modifiables (historique), fonctionnalités incluses. */
export function PlansView() {
  const t = useTranslations('platform.plans');
  const tf = useTranslations('platform.features');
  const plans = usePlatformPlans();
  if (plans.isPending) return <Skeleton className="h-96 w-full" />;
  if (!plans.data) return <LoadError error={plans.error} backHref="/platform" />;
  const list = plans.data.plans;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-3">
        {list.map((plan) => (
          <PlanCard key={plan.plan} plan={plan} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('featuresTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('featuresHint')}</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2 text-start font-medium">{t('feature')}</th>
                {list.map((plan) => (
                  <th key={plan.plan} className="py-2 text-center font-medium">
                    {plan.plan}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {FEATURE_KEYS.map((key) => (
                <tr key={key}>
                  <td className="py-2">{tf(key)}</td>
                  {list.map((plan) => (
                    <td key={plan.plan} className="py-2 text-center">
                      {plan.features.includes(key) ? (
                        <CheckIcon
                          className="mx-auto size-4 text-emerald-600"
                          aria-label={t('yes')}
                        />
                      ) : (
                        <MinusIcon
                          className="mx-auto size-4 text-muted-foreground"
                          aria-label={t('no')}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
