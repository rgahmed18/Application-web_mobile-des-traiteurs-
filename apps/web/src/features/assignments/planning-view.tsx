'use client';

import { addDays, todayInTimeZone } from '@traiteur/shared';
import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { formatLocalDate, weekdayName } from '@/lib/format/date';
import { cn } from '@/lib/utils';

import { usePlanning } from './assignments-api';
import { ASSIGNMENT_STATUS_STYLES } from './personnel-card';

/** Planning de l'équipe : une ligne par personne, une colonne par jour de la semaine. */
export function PlanningView() {
  const t = useTranslations('assignments');
  const tr = useTranslations('staff.roles');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [week, setWeek] = useState(() => todayInTimeZone(timeZone));
  const planning = usePlanning(week);
  const data = planning.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t('planning.previous')}
          onClick={() => setWeek(addDays(data?.weekStart ?? week, -7))}
        >
          <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('planning.next')}
          onClick={() => setWeek(addDays(data?.weekStart ?? week, 7))}
        >
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
        </Button>
        <Button variant="ghost" onClick={() => setWeek(todayInTimeZone(timeZone))}>
          {t('planning.thisWeek')}
        </Button>
        {data && (
          <p className="font-medium" data-testid="planning-title">
            {t('planning.week', {
              from: formatLocalDate(data.days[0] ?? data.weekStart),
              to: formatLocalDate(data.days[6] ?? data.weekStart),
            })}
          </p>
        )}
      </div>

      {planning.isPending || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.members.length === 0 ? (
        <p className="text-muted-foreground">{t('planning.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[56rem] table-fixed text-sm" data-testid="planning">
            <thead className="bg-muted/60">
              <tr>
                <th className="w-44 p-2 text-start">{t('planning.member')}</th>
                {data.days.map((day) => (
                  <th key={day} className="p-2 text-start font-medium">
                    <span className="block capitalize">{weekdayName(day, locale)}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {formatLocalDate(day)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.members.map((member) => (
                <tr key={member.id} className="align-top">
                  <td className="p-2">
                    <span className="block font-medium" dir="auto">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tr(`${member.role}.label`)}
                    </span>
                  </td>
                  {data.days.map((day) => {
                    const missions = member.missions.filter(
                      (mission) => mission.start.date === day,
                    );
                    return (
                      <td key={day} className="p-1">
                        <div className="flex flex-col gap-1">
                          {missions.map((mission) => (
                            <Link
                              key={mission.id}
                              href={`/admin/orders/${mission.orderId}`}
                              className={cn(
                                'rounded-md border px-1.5 py-1 text-xs hover:opacity-80',
                                ASSIGNMENT_STATUS_STYLES[mission.status],
                                mission.conflict && 'ring-2 ring-red-500',
                              )}
                              title={t(`status.${mission.status}`)}
                            >
                              <span className="flex items-center gap-1 font-medium" dir="ltr">
                                {mission.conflict && (
                                  <TriangleAlertIcon
                                    className="size-3 text-red-600"
                                    aria-label={t('planning.conflict')}
                                  />
                                )}
                                {mission.start.time}–{mission.end.time}
                              </span>
                              <span className="block truncate" dir="ltr">
                                {mission.orderReference}
                              </span>
                              <span className="block truncate">
                                {t(`roles.${mission.staffRole}`)}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
