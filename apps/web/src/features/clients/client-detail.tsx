'use client';

import { type Client, type ClientAddress, clientAddressInputSchema } from '@traiteur/shared';
import {
  ArrowLeftIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';

import { FormDialog } from '@/components/forms/form-dialog';
import { FormField } from '@/components/forms/form-field';
import { LoadError } from '@/components/layout/load-error';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/features/auth/session-provider';
import { OrderStatusBadge } from '@/features/orders/order-ui';
import { useOrders } from '@/features/orders/orders-api';
import { useTimeZone } from '@/features/traiteur/use-time-zone';
import { useErrorMessage } from '@/lib/api/use-error-message';
import { formatDate, formatLocalDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { useZodForm } from '@/lib/forms/use-zod-form';

import { ClientFormDialog } from './client-form-dialog';
import { clientName, useClient, useRemoveAddress, useSaveAddress } from './clients-api';

/** Lien WhatsApp : chiffres seuls, indicatif compris (wa.me/212612345678). */
const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

function AddressDialog({
  clientId,
  address,
  onClose,
}: {
  clientId: string;
  address: ClientAddress | null;
  onClose: () => void;
}) {
  const t = useTranslations('clients');
  const describeError = useErrorMessage();
  const save = useSaveAddress();
  const form = useZodForm(clientAddressInputSchema, {
    label: address?.label ?? '',
    address: address?.address ?? '',
    city: address?.city ?? '',
    isDefault: address?.isDefault ?? false,
  });
  const onSubmit = form.handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ clientId, addressId: address?.id ?? null, input });
      toast.success(t('detail.addressSaved'));
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  });
  return (
    <FormDialog
      open
      onClose={onClose}
      title={t(address ? 'detail.editAddress' : 'detail.addAddress')}
      dirty={form.formState.isDirty}
      submitting={form.formState.isSubmitting}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="label"
        label={t('fields.label')}
        render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
      />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField
          control={form.control}
          name="address"
          label={t('fields.address')}
          render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="city"
          label={t('fields.city')}
          render={(field, { invalid }) => <Input {...field} aria-invalid={invalid} />}
        />
      </div>
      <Controller
        control={form.control}
        name="isDefault"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Checkbox
              id="address-default"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
            <FieldLabel htmlFor="address-default" className="text-base font-normal">
              {t('fields.isDefault')}
            </FieldLabel>
          </Field>
        )}
      />
    </FormDialog>
  );
}

function Addresses({ client, canWrite }: { client: Client; canWrite: boolean }) {
  const t = useTranslations('clients');
  const tc = useTranslations('common');
  const describeError = useErrorMessage();
  const remove = useRemoveAddress();
  const [editing, setEditing] = useState<ClientAddress | null | undefined>(undefined);
  const [removing, setRemoving] = useState<ClientAddress | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('detail.addresses')}</CardTitle>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            <PlusIcon aria-hidden />
            {t('detail.addAddress')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {client.addresses.length === 0 ? (
          <p className="text-muted-foreground">{t('detail.noAddress')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {client.addresses.map((address) => (
              <li key={address.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {address.label}
                    {address.isDefault && (
                      <Badge variant="secondary">
                        <StarIcon aria-hidden />
                        {t('detail.default')}
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {address.address}, {address.city}
                  </p>
                </div>
                {canWrite && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('detail.editAddress')} — ${address.label}`}
                      onClick={() => setEditing(address)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('detail.removeAddress')} — ${address.label}`}
                      onClick={() => setRemoving(address)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing !== undefined && (
        <AddressDialog
          key={editing?.id ?? 'new'}
          clientId={client.id}
          address={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('detail.removeAddressConfirm', { label: removing?.label ?? '' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              variant="destructive"
              onClick={() => {
                if (!removing) return;
                remove.mutate(
                  { clientId: client.id, addressId: removing.id },
                  {
                    onSuccess: () => toast.success(t('detail.addressRemoved')),
                    onError: (error) => toast.error(describeError(error)),
                  },
                );
              }}
            >
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function OrderHistory({ clientId }: { clientId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const canRead = usePermission()('orders.read');
  const orders = useOrders(
    { clientId, sort: 'eventDate', direction: 'desc', pageSize: 50 },
    canRead,
  );
  if (!canRead) return null;
  const items = orders.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('clients.detail.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        {orders.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">{t('clients.detail.noOrders')}</p>
        ) : (
          <ul className="flex flex-col divide-y" data-testid="client-orders">
            {items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                >
                  <span className="font-medium" dir="ltr">
                    {order.reference}
                  </span>
                  <span className="text-muted-foreground">
                    {t(`eventType.${order.eventType}`)} ·{' '}
                    <span dir="ltr">{formatLocalDate(order.eventDate)}</span>
                  </span>
                  <span className="ms-auto font-medium tabular-nums" dir="ltr">
                    {formatMoney(order.totalTtc, locale)}
                  </span>
                  <OrderStatusBadge status={order.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ClientDetail({ clientId }: { clientId: string }) {
  const t = useTranslations('clients');
  const tc = useTranslations('common');
  const locale = useLocale();
  const can = usePermission();
  const timeZone = useTimeZone();
  const client = useClient(clientId);
  const [editing, setEditing] = useState(false);

  if (client.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!client.data) return <LoadError error={client.error} backHref="/admin/clients" />;

  const data = client.data;
  const canWrite = can('clients.write');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button asChild variant="link" className="self-start px-0">
          <Link href="/admin/clients">
            <ArrowLeftIcon className="rtl:rotate-180" aria-hidden />
            {tc('back')}
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{clientName(data)}</h1>
            {!data.active && <Badge variant="outline">{t('detail.inactive')}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={`tel:${data.phone}`}>
                <PhoneIcon aria-hidden />
                {t('detail.call')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={whatsappUrl(data.phone)} target="_blank" rel="noreferrer">
                <MessageCircleIcon aria-hidden />
                {t('detail.whatsapp')}
              </a>
            </Button>
            {canWrite && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon aria-hidden />
                {t('detail.edit')}
              </Button>
            )}
            {can('orders.create') && (
              <Button asChild>
                <Link href={`/admin/orders/new?client=${data.id}`}>
                  <PlusIcon aria-hidden />
                  {t('detail.newOrder')}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('detail.stats.orders')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.orderCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('detail.stats.totalSpent')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums" dir="ltr">
              {formatMoney(data.totalSpent, locale)}
            </p>
            <p className="text-sm text-muted-foreground">{t('detail.stats.totalSpentHint')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('detail.stats.nextOrder')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold" dir="ltr">
            {data.nextOrderAt ? formatDate(data.nextOrderAt, timeZone) : t('detail.stats.none')}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('detail.contact')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">{t('fields.phone')}</dt>
              <dd dir="ltr" className="text-start">
                {data.phone}
              </dd>
              <dt className="text-muted-foreground">{t('fields.email')}</dt>
              <dd dir="ltr" className="text-start">
                {data.email ?? '—'}
              </dd>
              <dt className="text-muted-foreground">{t('fields.locale')}</dt>
              <dd>{t(`locales.${data.locale}`)}</dd>
              <dt className="text-muted-foreground">{t('fields.tags')}</dt>
              <dd className="flex flex-wrap gap-1">
                {data.tags.length === 0
                  ? '—'
                  : data.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
              </dd>
            </dl>
            <div>
              <p className="text-muted-foreground">{t('detail.notes')}</p>
              <p className="whitespace-pre-line">{data.internalNotes ?? t('detail.noNotes')}</p>
            </div>
          </CardContent>
        </Card>
        <Addresses client={data} canWrite={canWrite} />
      </div>

      <OrderHistory clientId={data.id} />

      {editing && <ClientFormDialog client={data} onClose={() => setEditing(false)} />}
    </div>
  );
}
