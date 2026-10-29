'use client';

import type { PlatformDomain } from '@traiteur/shared';
import { CheckCircle2Icon, CopyIcon, GlobeIcon, PowerOffIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDateTime } from '@/lib/format/date';

import { useDomainAction, usePlatformDomains } from './platform-api';

function CopyValue({ label, value }: { label: string; value: string }) {
  const t = useTranslations('platform.domains');
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs break-all" dir="ltr">
          {value}
        </code>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t('copy', { label })}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => toast.success(t('copied')))
          }
        >
          <CopyIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * Domaine personnalisé du traiteur (offre Premium) : ajout, instructions DNS (CNAME et TXT de
 * vérification), vérification, coupure. Seul un domaine vérifié et actif est servi et reçoit un
 * certificat HTTPS.
 */
export function TraiteurDomainsCard({ traiteurId }: { traiteurId: string }) {
  const t = useTranslations('platform.domains');
  const describeError = useErrorMessage();
  const domains = usePlatformDomains(traiteurId);
  const action = useDomainAction(traiteurId);
  const [hostname, setHostname] = useState('');

  const run = (
    request: { method: 'POST' | 'DELETE'; path: string; body?: Record<string, unknown> },
    success: string,
    onDone?: () => void,
  ) =>
    action.mutate(request, {
      onSuccess: () => {
        toast.success(success);
        onDone?.();
      },
      onError: (error) => toast.error(describeError(error)),
    });

  const statusBadge = (domain: PlatformDomain) => (
    <Badge
      variant={domain.status === 'ACTIVE' ? 'default' : 'secondary'}
      data-testid={`domain-status-${domain.hostname}`}
    >
      {t(`status.${domain.status}`)}
    </Badge>
  );

  return (
    <Card data-testid="traiteur-domains">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GlobeIcon className="size-5" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {domains.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : !domains.data ? null : (
          <>
            {!domains.data.featureEnabled && (
              <p className="rounded-lg bg-muted p-3 text-muted-foreground">{t('featureOff')}</p>
            )}
            <ul className="flex flex-col gap-4">
              {domains.data.domains.map((domain) => (
                <li key={domain.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium" dir="ltr">
                      {domain.hostname}
                    </span>
                    {statusBadge(domain)}
                  </div>
                  {domain.status !== 'ACTIVE' && (
                    <div className="flex flex-col gap-2">
                      <p className="text-muted-foreground">{t('instructions')}</p>
                      <CopyValue
                        label={t('cnameLabel', { name: domain.hostname })}
                        value={domains.data.target}
                      />
                      <CopyValue label={t('txtName')} value={domain.verification.name} />
                      <CopyValue label={t('txtValue')} value={domain.verification.value} />
                    </div>
                  )}
                  {domain.lastCheckError && domain.status !== 'ACTIVE' && (
                    <p className="text-destructive">
                      {t('lastCheck', {
                        date: domain.lastCheckedAt ? formatDateTime(domain.lastCheckedAt) : '—',
                        error: domain.lastCheckError,
                      })}
                    </p>
                  )}
                  {domain.status === 'ACTIVE' && domain.verifiedAt && (
                    <p className="text-muted-foreground">
                      {t('verifiedOn', { date: formatDateTime(domain.verifiedAt) })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {domain.status !== 'ACTIVE' && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={action.isPending || !domains.data.featureEnabled}
                        onClick={() =>
                          run({ method: 'POST', path: `/${domain.id}/verify` }, t('verified'))
                        }
                      >
                        <CheckCircle2Icon aria-hidden />
                        {t('verify')}
                      </Button>
                    )}
                    {domain.status === 'ACTIVE' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={action.isPending}
                        onClick={() =>
                          run({ method: 'POST', path: `/${domain.id}/disable` }, t('disabled'))
                        }
                      >
                        <PowerOffIcon aria-hidden />
                        {t('disable')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      onClick={() => run({ method: 'DELETE', path: `/${domain.id}` }, t('removed'))}
                    >
                      <Trash2Icon aria-hidden />
                      {t('remove')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {domains.data.featureEnabled && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!hostname.trim()) return;
                  run(
                    { method: 'POST', path: '', body: { hostname: hostname.trim() } },
                    t('added'),
                    () => setHostname(''),
                  );
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  {t('newDomain')}
                  <Input
                    value={hostname}
                    dir="ltr"
                    placeholder="traiteur-exemple.ma"
                    onChange={(event) => setHostname(event.target.value)}
                  />
                </label>
                <Button type="submit" disabled={action.isPending || !hostname.trim()}>
                  {t('add')}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
