'use client';

import { useQueryClient } from '@tanstack/react-query';
import { isValidLocalDate, todayInTimeZone } from '@traiteur/shared';
import { useSearchParams } from 'next/navigation';

import { LoadError } from '@/components/layout/load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/auth-gates';
import { useCatalogSettings } from '@/features/catalog/catalog-api';

import { orderKeys, useOrder } from '../orders-api';
import { OrderForm } from './order-form';

/** Nouvelle commande (?date=AAAA-MM-JJ, ?client=<id> depuis le calendrier ou une fiche client) ou modification. */
export function OrderEditor({ orderId }: { orderId: string | null }) {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const settings = useCatalogSettings();
  const order = useOrder(orderId);

  const content = () => {
    if (orderId && order.isError) return <LoadError error={order.error} backHref="/admin/orders" />;
    if (!settings.data || (orderId && !order.data)) {
      return (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    const requestedDate = params.get('date');
    const initialDate =
      requestedDate && isValidLocalDate(requestedDate)
        ? requestedDate
        : todayInTimeZone(settings.data.timezone);
    return (
      <OrderForm
        // Recréé avec la dernière version après un rechargement (conflit de modification)
        key={order.data ? `${order.data.id}:${order.data.version}` : 'new'}
        settings={settings.data}
        order={order.data}
        initialDate={initialDate}
        initialClientId={params.get('client') ?? ''}
        onReload={() => {
          if (orderId) void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
        }}
      />
    );
  };

  return (
    <RequirePermission permission={orderId ? 'orders.write' : 'orders.create'}>
      {content()}
    </RequirePermission>
  );
}
