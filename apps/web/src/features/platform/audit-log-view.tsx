'use client';

import type { PlatformAuditEntry } from '@traiteur/shared';
import { ScrollTextIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, PaginationBar } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format/date';

import { useActionLabel } from './action-label';
import { AuditDetailDialog } from './audit-detail-dialog';
import { useAuditDescriber } from './audit-summary';
import { usePlatformAudit, usePlatformAuditOptions } from './platform-api';

const PAGE_SIZE = 50;
const ALL = 'all';

interface Filters {
  scope: 'platform' | 'all';
  actorUserId: string;
  action: string;
  traiteurId: string;
  from: string;
  to: string;
}

const INITIAL_FILTERS: Filters = {
  scope: 'platform',
  actorUserId: ALL,
  action: ALL,
  traiteurId: ALL,
  from: '',
  to: '',
};

/** Auteur d'une action : nom (jamais celui d'un client) et rôle, ou « Système ». */
function ActorCell({ actor }: { actor: PlatformAuditEntry['actor'] }) {
  const t = useTranslations('platform.audit');
  if (!actor) return <span className="text-muted-foreground">{t('system')}</span>;
  return (
    <span className="flex flex-col">
      <span dir="auto">{actor.name ?? t('hiddenName')}</span>
      {actor.role && (
        <span className="text-xs text-muted-foreground">{t(`roles.${actor.role}`)}</span>
      )}
    </span>
  );
}

/**
 * Journal d'audit de la console : qui a fait quoi, chez quel traiteur, quand. Par défaut les
 * actions de la plateforme ; « Toutes les actions » ajoute celles des équipes des traiteurs, sans
 * leur contenu.
 */
export function AuditLogView() {
  const t = useTranslations('platform.audit');
  const actionLabel = useActionLabel();
  const describe = useAuditDescriber();
  const [selected, setSelected] = useState<PlatformAuditEntry | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const options = usePlatformAuditOptions();
  const invalidPeriod = filters.from !== '' && filters.to !== '' && filters.from > filters.to;
  const audit = usePlatformAudit({
    scope: filters.scope,
    actorUserId: filters.actorUserId === ALL ? undefined : filters.actorUserId,
    action: filters.action === ALL ? undefined : filters.action,
    traiteurId: filters.traiteurId === ALL ? undefined : filters.traiteurId,
    from: filters.from || undefined,
    to: invalidPeriod ? undefined : filters.to || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(INITIAL_FILTERS);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-scope">{t('scope')}</Label>
          <Select
            value={filters.scope}
            onValueChange={(value) => update({ scope: value as Filters['scope'] })}
          >
            <SelectTrigger id="audit-scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platform">{t('scopes.platform')}</SelectItem>
              <SelectItem value="all">{t('scopes.all')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-actor">{t('actor')}</Label>
          <Select
            value={filters.actorUserId}
            onValueChange={(value) => update({ actorUserId: value })}
          >
            <SelectTrigger id="audit-actor" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allActors')}</SelectItem>
              {options.data?.actors.map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-action">{t('action')}</Label>
          <Select value={filters.action} onValueChange={(value) => update({ action: value })}>
            <SelectTrigger id="audit-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allActions')}</SelectItem>
              {options.data?.actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {actionLabel(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-traiteur">{t('traiteur')}</Label>
          <Select
            value={filters.traiteurId}
            onValueChange={(value) => update({ traiteurId: value })}
          >
            <SelectTrigger id="audit-traiteur" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allTraiteurs')}</SelectItem>
              {options.data?.traiteurs.map((traiteur) => (
                <SelectItem key={traiteur.id} value={traiteur.id}>
                  {traiteur.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-from">{t('from')}</Label>
          <Input
            id="audit-from"
            type="date"
            dir="ltr"
            value={filters.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-to">{t('to')}</Label>
          <Input
            id="audit-to"
            type="date"
            dir="ltr"
            value={filters.to}
            aria-invalid={invalidPeriod}
            onChange={(event) => update({ to: event.target.value })}
          />
          {invalidPeriod && <p className="text-sm text-destructive">{t('invalidPeriod')}</p>}
        </div>
      </div>
      {filtered && (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => update(INITIAL_FILTERS)}
        >
          {t('reset')}
        </Button>
      )}

      {audit.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !audit.data ? (
        <LoadError error={audit.error} backHref="/platform" />
      ) : audit.data.items.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('count', { count: audit.data.total })}</p>
          <ul className="flex flex-col divide-y rounded-xl border bg-card" data-testid="audit-list">
            {audit.data.items.map((entry) => (
              <li key={entry.id}>
                {/* Ligne cliquable : vue détail (avant / après) */}
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="grid w-full grid-cols-1 gap-2 p-4 text-start text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none md:grid-cols-[10rem_2fr_1.5fr_1.5fr] md:items-start"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {formatDateTime(entry.at)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{actionLabel(entry.action)}</span>
                    {describe.summary(entry) && (
                      <span className="break-words text-muted-foreground" dir="auto">
                        {describe.summary(entry)}
                      </span>
                    )}
                  </span>
                  <span dir="auto">
                    {entry.traiteur?.name ?? (
                      <span className="text-muted-foreground">{t('noTraiteur')}</span>
                    )}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <ActorCell actor={entry.actor} />
                    {entry.ipAddress && (
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {entry.ipAddress}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <AuditDetailDialog entry={selected} onClose={() => setSelected(null)} />
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={audit.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
