'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Notification, notificationFeedSchema } from '@traiteur/shared';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSession } from '@/features/auth/session-provider';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { apiRequest } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';

const FEED_KEY = ['notifications'] as const;
/** Relecture toutes les minutes, et au retour sur l'onglet. */
const REFRESH_MS = 60_000;

/** Page du back-office liée à une notification. */
function linkOf(notification: Notification): string {
  if (notification.entityType === 'Membership') return `/admin/clients/${notification.entityId}`;
  if (notification.entityType === 'Order') return `/admin/orders/${notification.entityId}`;
  return notification.data.orderId ? `/admin/orders/${notification.data.orderId}` : '/admin/orders';
}

/**
 * Cloche du back-office : nouveaux clients (à valider), demandes en ligne, réponses aux devis.
 * Chaque membre ne voit que ce que ses droits permettent ; la lecture lui est propre.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const session = useSession();
  const timeZone = useTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const enabled = session.status === 'authenticated' && session.context?.traiteurId !== null;
  const feed = useQuery({
    queryKey: FEED_KEY,
    queryFn: ({ signal }) =>
      apiRequest('/notifications', { schema: notificationFeedSchema, signal }),
    enabled,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const markRead = useMutation({
    mutationFn: (id: string | null) =>
      apiRequest(id ? `/notifications/${id}/read` : '/notifications/read-all', {
        method: 'POST',
        schema: notificationFeedSchema,
      }),
    onSuccess: (data) => queryClient.setQueryData(FEED_KEY, data),
  });
  if (!enabled) return null;
  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? t('labelUnread', { count: unread }) : t('label')}
          data-testid="notification-bell"
        >
          <BellIcon aria-hidden />
          {unread > 0 && (
            <span
              className="absolute -end-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
              data-testid="notification-count"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <span className="font-semibold">{t('title')}</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markRead.mutate(null)}
              disabled={markRead.isPending}
            >
              <CheckCheckIcon aria-hidden />
              {t('markAll')}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto" data-testid="notification-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 p-3 text-start hover:bg-muted/60 ${item.read ? '' : 'bg-primary/5'}`}
                  onClick={() => {
                    if (!item.read) markRead.mutate(item.id);
                    setOpen(false);
                    router.push(linkOf(item));
                  }}
                >
                  <span className={`text-sm ${item.read ? '' : 'font-semibold'}`} dir="auto">
                    {t(`types.${item.type}`, {
                      client: item.data.clientName,
                      reference: item.data.reference ?? '',
                    })}
                  </span>
                  {item.data.reason && (
                    <span className="text-sm text-muted-foreground" dir="auto">
                      {t('reason', { reason: item.data.reason })}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {formatDateTime(item.createdAt, timeZone)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
