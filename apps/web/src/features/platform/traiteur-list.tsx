'use client';

import {
  type PlatformTraiteur,
  type PlatformTraiteurCreateResult,
  TRAITEUR_STATUSES,
  type TraiteurStatus,
} from '@traiteur/shared';
import { PlusIcon, SearchIcon, SendIcon, StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/features/catalog/use-debounced-value';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate } from '@/lib/format/date';

import { AdminLinkDialog } from './admin-link-dialog';
import { useResendAdminInvitation, usePlatformTraiteurs } from './platform-api';
import { TraiteurStatusBadge } from './platform-dashboard-view';

const PAGE_SIZE = 25;
const ALL = 'all';

/** État de l'accès du premier administrateur. */
function AdminCell({ traiteur }: { traiteur: PlatformTraiteur }) {
  const t = useTranslations('platform.traiteurs');
  const { admin } = traiteur;
  if (!admin) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col">
      <span dir="auto">
        {admin.firstName} {admin.lastName}
      </span>
      <span className="text-xs text-muted-foreground">
        {admin.status === 'INVITED'
          ? admin.invitationExpiresAt && new Date(admin.invitationExpiresAt) > new Date()
            ? t('adminInvited', { date: formatDate(admin.invitationExpiresAt) })
            : t('adminLinkExpired')
          : t(`adminStatus.${admin.status}`)}
      </span>
    </span>
  );
}

/** Traiteurs de la plateforme : recherche, statut, offre, administrateur, activité du mois. */
export function TraiteurList() {
  const t = useTranslations('platform.traiteurs');
  const ts = useTranslations('platform.status');
  const describeError = useErrorMessage();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TraiteurStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [link, setLink] = useState<PlatformTraiteurCreateResult | null>(null);
  const debounced = useDebouncedValue(search.trim());
  const traiteurs = usePlatformTraiteurs({
    search: debounced || undefined,
    status: status === ALL ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const resend = useResendAdminInvitation();

  const newButton = (
    <Button asChild>
      <Link href="/platform/traiteurs/new">
        <PlusIcon aria-hidden />
        {t('new')}
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} actions={newButton} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </InputGroup>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as TraiteurStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48" aria-label={t('statusFilter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {TRAITEUR_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {ts(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {traiteurs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !traiteurs.data || traiteurs.data.items.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title={t('empty')}
          description={t('emptyHint')}
          action={newButton}
        />
      ) : (
        <>
          <ul
            className="flex flex-col divide-y rounded-xl border bg-card"
            data-testid="traiteur-list"
          >
            {traiteurs.data.items.map((traiteur) => (
              <li
                key={traiteur.id}
                className="grid grid-cols-1 gap-2 p-4 md:grid-cols-[2fr_1fr_1fr_2fr_auto] md:items-center"
              >
                <span className="flex flex-col">
                  <span className="font-medium" dir="auto">
                    {traiteur.name}
                  </span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {traiteur.slug} · {traiteur.city ?? '—'}
                  </span>
                </span>
                <span className="text-sm">
                  {traiteur.plan}
                  <span className="block text-xs text-muted-foreground">
                    {t('orders', { count: traiteur.ordersThisMonth })}
                  </span>
                </span>
                <span className="flex flex-col items-start gap-1">
                  <TraiteurStatusBadge status={traiteur.status} />
                  {traiteur.status === 'TRIAL' && traiteur.trialEndsAt && (
                    <span className="text-xs text-muted-foreground">
                      {t('trialUntil', { date: formatDate(traiteur.trialEndsAt) })}
                    </span>
                  )}
                </span>
                <AdminCell traiteur={traiteur} />
                <span>
                  {traiteur.admin?.status === 'INVITED' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={resend.isPending}
                      onClick={() =>
                        resend.mutate(traiteur.id, {
                          onSuccess: setLink,
                          onError: (error) => toast.error(describeError(error)),
                        })
                      }
                    >
                      <SendIcon aria-hidden />
                      {t('resend')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={traiteurs.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      <AdminLinkDialog result={link} onClose={() => setLink(null)} />
    </div>
  );
}
