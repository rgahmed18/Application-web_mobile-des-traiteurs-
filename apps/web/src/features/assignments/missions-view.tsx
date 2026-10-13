'use client';

import { lineLabelText, type MissionSummary } from '@traiteur/shared';
import {
  CalendarIcon,
  CheckIcon,
  ChefHatIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  MapPinIcon,
  MessageCircleIcon,
  NavigationIcon,
  PhoneIcon,
  TruckIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/list-states';
import { LoadError } from '@/components/layout/load-error';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReasonDialog } from '@/features/orders/order-dialogs';
import { openDocument } from '@/features/payments/payments-api';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatLongDate, formatLocalDate } from '@/lib/format/date';

import { useMission, useMissionAction, useMissions } from './assignments-api';
import { MissionCashCard } from './mission-cash';
import { ASSIGNMENT_STATUS_STYLES } from './personnel-card';

/** Statut de la mission ; une commande annulée prime. */
function MissionBadge({ mission }: { mission: Pick<MissionSummary, 'status' | 'orderStatus'> }) {
  const t = useTranslations('assignments');
  if (mission.orderStatus === 'CANCELLED') {
    return <Badge variant="destructive">{t('missions.cancelled')}</Badge>;
  }
  return (
    <Badge variant="outline" className={ASSIGNMENT_STATUS_STYLES[mission.status]}>
      {t(`status.${mission.status}`)}
    </Badge>
  );
}

/** Mes missions : uniquement les miennes, sans aucun prix. */
export function MissionsList() {
  const t = useTranslations('assignments.missions');
  const ta = useTranslations('assignments');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const missions = useMissions(scope);
  const items = missions.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Tabs value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
        <TabsList>
          <TabsTrigger value="upcoming">{t('upcoming')}</TabsTrigger>
          <TabsTrigger value="past">{t('past')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {missions.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : missions.isError ? (
        <LoadError error={missions.error} backHref="/admin" />
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="missions-list">
          {items.map((mission) => (
            <li key={mission.id}>
              <Link
                href={`/admin/missions/${mission.id}`}
                className="flex items-center gap-3 rounded-xl border p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium capitalize">
                    {formatLongDate(mission.start.date, locale)} ·{' '}
                    <span dir="ltr">
                      {mission.start.time} → {mission.end.time}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {ta(`roles.${mission.staffRole}`)} · {tEvent(mission.eventType)} ·{' '}
                    {t('guests', { count: mission.guestCount })}
                  </p>
                  <p className="truncate text-sm" dir="auto">
                    {mission.place}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <MissionBadge mission={mission} />
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {mission.orderReference}
                  </span>
                </div>
                <ChevronRightIcon
                  className="size-5 shrink-0 text-muted-foreground rtl:rotate-180"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Détail d'une mission : ce qui sert à l'exécution, et les actions du membre. */
export function MissionDetail({ id }: { id: string }) {
  const t = useTranslations('assignments.missions');
  const ta = useTranslations('assignments');
  const tEvent = useTranslations('eventType');
  const locale = useLocale();
  const describeError = useErrorMessage();
  const mission = useMission(id);
  const action = useMissionAction(id);
  const [declining, setDeclining] = useState(false);
  const fail = (error: unknown) => toast.error(describeError(error));

  if (mission.isPending) return <Skeleton className="h-96 w-full" />;
  if (mission.isError || !mission.data) {
    return <LoadError error={mission.error} backHref="/admin/missions" />;
  }
  const data = mission.data;
  const run = (payload: Parameters<typeof action.mutate>[0], done: string) =>
    action.mutate(payload, { onSuccess: () => toast.success(done), onError: fail });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" data-testid="mission-detail">
      <Button asChild variant="ghost" className="self-start">
        <Link href="/admin/missions">{t('back')}</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">
          {ta(`roles.${data.staffRole}`)} — {tEvent(data.eventType)}
        </h1>
        <MissionBadge mission={data} />
      </div>
      <p className="text-sm text-muted-foreground" dir="ltr">
        {data.orderReference}
      </p>

      {data.redacted && <p className="rounded-lg bg-muted p-3 text-sm">{t('redacted')}</p>}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="flex items-start gap-3">
            <CalendarIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="block font-medium">
                {t('mission')} :{' '}
                <span className="capitalize">{formatLongDate(data.start.date, locale)}</span>{' '}
                <span dir="ltr">
                  {data.start.time} → {data.end.time}
                </span>
              </span>
              <span className="block text-sm text-muted-foreground">
                {t('event')} : {formatLocalDate(data.event.date)}{' '}
                <span dir="ltr">
                  {data.event.startTime}
                  {data.event.endTime ? ` → ${data.event.endTime}` : ''}
                </span>
                {data.event.endsNextDay && ` ${t('nextDay')}`}
              </span>
            </span>
          </p>
          <p className="flex items-center gap-3">
            <UsersIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            {t('guests', { count: data.guestCount })}
          </p>
          <div className="flex items-start gap-3">
            <MapPinIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            {data.venue ? (
              <div className="flex flex-col gap-2">
                <span dir="auto">
                  {data.venue.name && <span className="block font-medium">{data.venue.name}</span>}
                  {data.venue.address}, {data.venue.city}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={data.venue.mapsUrl} target="_blank" rel="noreferrer noopener">
                      <MapPinIcon aria-hidden />
                      {t('openMaps')}
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={data.venue.directionsUrl} target="_blank" rel="noreferrer noopener">
                      <NavigationIcon aria-hidden />
                      {t('directions')}
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <span>{data.place}</span>
            )}
          </div>
          {data.contact && (
            <div className="flex items-start gap-3">
              <PhoneIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex flex-col gap-2">
                <span>
                  <span className="text-sm text-muted-foreground">{t('contact')} : </span>
                  <span dir="auto">{data.contact.name}</span>{' '}
                  <span dir="ltr">{data.contact.phone}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`tel:${data.contact.phone}`}>
                      <PhoneIcon aria-hidden />
                      {t('call')}
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`https://wa.me/${data.contact.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <MessageCircleIcon aria-hidden />
                      WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('content')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y" data-testid="mission-content">
            {data.content.map((item, index) => (
              <li key={index} className="flex justify-between gap-4 py-2">
                <span dir="auto">{lineLabelText(item.label, locale)}</span>
                <span className="font-medium tabular-nums">× {item.quantity}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {(data.equipment || data.serviceNotes || data.missionNotes || data.clientNotes) && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 text-sm">
            {data.missionNotes && <Note title={t('missionNotes')} text={data.missionNotes} />}
            {data.equipment && <Note title={t('equipment')} text={data.equipment} />}
            {data.serviceNotes && <Note title={t('serviceNotes')} text={data.serviceNotes} />}
            {data.clientNotes && <Note title={t('clientNotes')} text={data.clientNotes} />}
          </CardContent>
        </Card>
      )}

      {data.team.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('team')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {data.team.map((member, index) => (
                <li key={index} className="flex items-center gap-3 py-2">
                  <span className="flex-1" dir="auto">
                    {member.firstName} {member.lastName}
                    {member.isSelf && <span className="text-muted-foreground"> ({t('you')})</span>}
                    <span className="block text-sm text-muted-foreground">
                      {ta(`roles.${member.staffRole}`)}
                    </span>
                  </span>
                  {member.phone && !member.isSelf && (
                    <Button asChild variant="ghost" size="icon" aria-label={t('call')}>
                      <a href={`tel:${member.phone}`}>
                        <PhoneIcon aria-hidden />
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.cashCollection && <MissionCashCard missionId={id} cash={data.cashCollection} />}

      {data.declineReason && data.status === 'DECLINED' && (
        <p className="text-sm text-destructive">{ta('declined', { reason: data.declineReason })}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {data.canConfirm && (
          <Button
            size="lg"
            disabled={action.isPending}
            onClick={() => run({ kind: 'confirm' }, t('confirmed'))}
          >
            <CheckIcon aria-hidden />
            {t('confirm')}
          </Button>
        )}
        {data.deliverySteps.map((step) => (
          <Button
            key={step}
            size="lg"
            variant={step === 'DELIVERED' ? 'default' : 'secondary'}
            disabled={action.isPending}
            onClick={() => run({ kind: 'delivery', to: step }, t(`steps.${step}.done`))}
          >
            <TruckIcon aria-hidden />
            {t(`steps.${step}.label`)}
          </Button>
        ))}
        {data.canFinish && (
          <Button
            size="lg"
            variant="secondary"
            disabled={action.isPending}
            onClick={() => run({ kind: 'done' }, t('finished'))}
          >
            <CheckIcon aria-hidden />
            {t('finish')}
          </Button>
        )}
        {data.documents.deliveryNote && (
          <Button
            size="lg"
            variant="outline"
            onClick={() => openDocument(`/me/missions/${id}/delivery-note`).catch(fail)}
          >
            <TruckIcon aria-hidden />
            {ta('deliveryNote')}
          </Button>
        )}
        {data.documents.preparationSheet && (
          <Button
            size="lg"
            variant="outline"
            onClick={() =>
              openDocument(
                `/me/missions/${id}/preparation-sheet?locale=${locale === 'ar' ? 'ar' : 'fr'}`,
              ).catch(fail)
            }
          >
            <ChefHatIcon aria-hidden />
            {ta('preparationSheet')}
          </Button>
        )}
        {data.canDecline && (
          <Button size="lg" variant="ghost" onClick={() => setDeclining(true)}>
            <XIcon aria-hidden />
            {t('decline')}
          </Button>
        )}
      </div>

      <ReasonDialog
        open={declining}
        title={t('declineDialog.title')}
        description={t('declineDialog.description')}
        label={t('declineDialog.reason')}
        confirmLabel={t('declineDialog.confirm')}
        destructive
        pending={action.isPending}
        onCancel={() => setDeclining(false)}
        onConfirm={(reason) =>
          action.mutate(
            { kind: 'decline', reason },
            {
              onSuccess: () => {
                toast.success(t('declineDialog.done'));
                setDeclining(false);
              },
              onError: fail,
            },
          )
        }
      />
    </div>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <p className="whitespace-pre-line text-muted-foreground" dir="auto">
        {text}
      </p>
    </div>
  );
}
